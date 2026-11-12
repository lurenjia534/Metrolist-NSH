// SPDX-License-Identifier: GPL-3.0-only
#import "ios_auth.h"
#import <AuthenticationServices/AuthenticationServices.h>
#import <CommonCrypto/CommonDigest.h>
#import <Security/Security.h>
#import <UIKit/UIKit.h>

static NSString *const MSPConfigurationKey = @"metrolist.spotify.configuration";
static NSString *const MSPScopes = @"streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state user-library-read user-library-modify playlist-read-private playlist-read-collaborative user-read-recently-played user-follow-read app-remote-control";

NSError *MSPError(NSString *code, NSString *message) {
    return [NSError errorWithDomain:@"MetrolistSpotify" code:1
                          userInfo:@{NSLocalizedDescriptionKey: message, @"spotifyCode": code}];
}

NSString *MSPErrorText(NSError *error) {
    return [NSString stringWithFormat:@"%@: %@", error.userInfo[@"spotifyCode"] ?: @"E_NATIVE", error.localizedDescription];
}

static NSString *base64url(NSData *data) {
    NSString *encoded = [data base64EncodedStringWithOptions:0];
    encoded = [encoded stringByReplacingOccurrencesOfString:@"+" withString:@"-"];
    encoded = [encoded stringByReplacingOccurrencesOfString:@"/" withString:@"_"];
    return [encoded stringByReplacingOccurrencesOfString:@"=" withString:@""];
}

static NSString *randomToken(NSUInteger length, NSError **error) {
    NSMutableData *data = [NSMutableData dataWithLength:length];
    OSStatus status = SecRandomCopyBytes(kSecRandomDefault, length, data.mutableBytes);
    if (status != errSecSuccess) {
        *error = MSPError(@"E_AUTH", @"The system could not create the Spotify authorization request.");
        return nil;
    }
    return base64url(data);
}

static NSData *formBody(NSDictionary<NSString *, NSString *> *values) {
    NSCharacterSet *unreserved = [NSCharacterSet characterSetWithCharactersInString:
        @"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"];
    NSMutableArray<NSString *> *parts = [NSMutableArray array];
    for (NSString *key in values) {
        [parts addObject:[NSString stringWithFormat:@"%@=%@",
            [key stringByAddingPercentEncodingWithAllowedCharacters:unreserved],
            [values[key] stringByAddingPercentEncodingWithAllowedCharacters:unreserved]]];
    }
    return [[parts componentsJoinedByString:@"&"] dataUsingEncoding:NSUTF8StringEncoding];
}

@interface MSPOAuth () <ASWebAuthenticationPresentationContextProviding>
@property(nonatomic, copy) NSString *clientId;
@property(nonatomic, copy) NSString *redirectUri;
@property(nonatomic, copy) NSString *accessToken;
@property(nonatomic, copy) NSString *refreshToken;
@property(nonatomic) NSTimeInterval expiresAt;
@property(nonatomic) NSUInteger revision;
@property(nonatomic) NSUInteger generation;
@property(nonatomic) BOOL signingIn;
@property(nonatomic) BOOL refreshing;
@property(nonatomic, strong) ASWebAuthenticationSession *authentication;
@property(nonatomic, copy) MSPTokenCompletion signInCompletion;
@property(nonatomic, strong) NSMutableArray<MSPTokenCompletion> *refreshWaiters;
@property(nonatomic, strong) NSError *storageError;
@end

@implementation MSPOAuth

- (instancetype)init {
    self = [super init];
    if (self) {
        _refreshWaiters = [NSMutableArray array];
        NSDictionary *saved = [NSUserDefaults.standardUserDefaults dictionaryForKey:MSPConfigurationKey];
        _clientId = saved[@"clientId"] ?: @"";
        _redirectUri = saved[@"redirectUri"] ?: @"metrolist-spotify://callback";
        [self restoreTokens];
    }
    return self;
}

- (BOOL)configured { return self.clientId.length > 0; }
- (BOOL)signedIn { return self.accessToken.length > 0 || self.refreshToken.length > 0; }

- (NSMutableDictionary *)keychainQuery {
    NSString *service = [NSString stringWithFormat:@"%@.spotify.oauth", NSBundle.mainBundle.bundleIdentifier];
    return [@{(__bridge id)kSecClass: (__bridge id)kSecClassGenericPassword,
              (__bridge id)kSecAttrService: service,
              (__bridge id)kSecAttrAccount: [NSString stringWithFormat:@"%@|%@", self.clientId, self.redirectUri]} mutableCopy];
}

- (void)restoreTokens {
    self.accessToken = nil;
    self.refreshToken = nil;
    self.expiresAt = 0;
    self.storageError = nil;
    if (!self.configured) return;
    NSMutableDictionary *query = [self keychainQuery];
    query[(__bridge id)kSecReturnData] = @YES;
    CFTypeRef result = NULL;
    OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, &result);
    if (status == errSecItemNotFound) return;
    if (status != errSecSuccess) {
        self.storageError = MSPError(@"E_STORAGE", @"The system could not read the saved Spotify session.");
        return;
    }
    NSData *data = CFBridgingRelease(result);
    NSError *error = nil;
    NSDictionary *tokens = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
    self.storageError = error;
    self.accessToken = tokens[@"accessToken"];
    self.refreshToken = tokens[@"refreshToken"];
    self.expiresAt = [tokens[@"expiresAt"] doubleValue];
}

- (NSError *)saveTokens {
    NSDictionary *tokens = @{@"accessToken": self.accessToken,
                             @"refreshToken": self.refreshToken ?: @"",
                             @"expiresAt": @(self.expiresAt)};
    NSData *data = [NSJSONSerialization dataWithJSONObject:tokens options:0 error:nil];
    NSMutableDictionary *query = [self keychainQuery];
    NSDictionary *update = @{(__bridge id)kSecValueData: data};
    OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)query, (__bridge CFDictionaryRef)update);
    if (status == errSecItemNotFound) {
        [query addEntriesFromDictionary:update];
        query[(__bridge id)kSecAttrAccessible] = (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly;
        status = SecItemAdd((__bridge CFDictionaryRef)query, NULL);
    }
    return status == errSecSuccess ? nil : MSPError(@"E_STORAGE", @"The system could not save the Spotify session.");
}

- (void)configure:(NSString *)clientId redirectUri:(NSString *)redirectUri {
    if ([self.clientId isEqualToString:clientId] && [self.redirectUri isEqualToString:redirectUri]) return;
    [self cancelSignIn];
    self.generation++;
    self.clientId = clientId;
    self.redirectUri = redirectUri;
    [NSUserDefaults.standardUserDefaults setObject:@{@"clientId": clientId, @"redirectUri": redirectUri}
                                           forKey:MSPConfigurationKey];
    [self restoreTokens];
    self.revision++;
    if (self.changed) self.changed();
}

- (void)exchange:(NSDictionary<NSString *, NSString *> *)parameters completion:(MSPTokenCompletion)completion {
    NSUInteger generation = self.generation;
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://accounts.spotify.com/api/token"]];
    request.HTTPMethod = @"POST";
    [request setValue:@"application/x-www-form-urlencoded" forHTTPHeaderField:@"Content-Type"];
    request.HTTPBody = formBody(parameters);
    [[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:
        ^(NSData *data, NSURLResponse *response, NSError *networkError) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (generation != self.generation) {
                completion(nil, MSPError(@"E_CANCELLED", @"The Spotify session changed during authorization."));
                return;
            }
            NSError *error = networkError;
            NSDictionary *result = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:&error] : nil;
            NSInteger status = [(NSHTTPURLResponse *)response statusCode];
            if (error || status < 200 || status >= 300 || ![result[@"access_token"] length]) {
                if ([result[@"error"] isEqual:@"invalid_grant"]) {
                    [self clearTokens];
                    if (self.changed) self.changed();
                }
                completion(nil, MSPError(@"E_AUTH", result[@"error_description"] ?: error.localizedDescription ?: @"Spotify did not issue an access token."));
                return;
            }
            self.accessToken = result[@"access_token"];
            if ([result[@"refresh_token"] length]) self.refreshToken = result[@"refresh_token"];
            self.expiresAt = NSDate.date.timeIntervalSince1970 * 1000 + [result[@"expires_in"] doubleValue] * 1000;
            self.storageError = [self saveTokens];
            self.revision++;
            if (self.changed) self.changed();
            completion(self.storageError ? nil : self.accessToken, self.storageError);
        });
    }] resume];
}

- (void)finishSignIn:(NSString *)token error:(NSError *)error {
    MSPTokenCompletion completion = self.signInCompletion;
    self.signInCompletion = nil;
    self.authentication = nil;
    self.signingIn = NO;
    if (self.changed) self.changed();
    if (completion) completion(token, error);
}

- (void)signIn:(MSPTokenCompletion)completion {
    if (!self.configured) {
        completion(nil, MSPError(@"E_CONFIG", @"Set the Spotify application Client ID before signing in."));
        return;
    }
    [self cancelSignIn];
    self.generation++;
    NSUInteger generation = self.generation;
    NSError *randomError = nil;
    NSString *verifier = randomToken(32, &randomError);
    NSString *state = randomToken(24, &randomError);
    if (randomError) { completion(nil, randomError); return; }
    NSData *bytes = [verifier dataUsingEncoding:NSASCIIStringEncoding];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(bytes.bytes, (CC_LONG)bytes.length, digest);
    NSString *challenge = base64url([NSData dataWithBytes:digest length:sizeof(digest)]);
    NSURLComponents *url = [NSURLComponents componentsWithString:@"https://accounts.spotify.com/authorize"];
    NSDictionary *parameters = @{@"client_id": self.clientId, @"response_type": @"code",
        @"redirect_uri": self.redirectUri, @"scope": MSPScopes, @"state": state,
        @"code_challenge_method": @"S256", @"code_challenge": challenge};
    NSMutableArray *items = [NSMutableArray array];
    for (NSString *key in parameters) [items addObject:[NSURLQueryItem queryItemWithName:key value:parameters[key]]];
    url.queryItems = items;
    self.signInCompletion = completion;
    self.signingIn = YES;
    self.authentication = [[ASWebAuthenticationSession alloc] initWithURL:url.URL
        callbackURLScheme:[NSURL URLWithString:self.redirectUri].scheme
        completionHandler:^(NSURL *callback, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (generation != self.generation) return;
            if (error) {
                NSString *code = error.code == ASWebAuthenticationSessionErrorCodeCanceledLogin ? @"E_CANCELLED" : @"E_AUTH";
                [self finishSignIn:nil error:MSPError(code, error.localizedDescription)];
                return;
            }
            NSURLComponents *returned = [NSURLComponents componentsWithURL:callback resolvingAgainstBaseURL:NO];
            NSMutableDictionary *values = [NSMutableDictionary dictionary];
            for (NSURLQueryItem *item in returned.queryItems) values[item.name] = item.value ?: @"";
            NSString *address = [[callback.absoluteString componentsSeparatedByString:@"?"] firstObject];
            if (![address isEqualToString:self.redirectUri] || ![values[@"state"] isEqualToString:state]) {
                [self finishSignIn:nil error:MSPError(@"E_AUTH", @"The Spotify authorization callback did not match this sign-in request.")];
                return;
            }
            if (![values[@"code"] length]) {
                [self finishSignIn:nil error:MSPError(@"E_AUTH", values[@"error_description"] ?: values[@"error"] ?: @"Spotify authorization was not completed.")];
                return;
            }
            [self exchange:@{@"grant_type": @"authorization_code", @"client_id": self.clientId,
                @"redirect_uri": self.redirectUri, @"code": values[@"code"], @"code_verifier": verifier}
                completion:^(NSString *token, NSError *exchangeError) {
                    if (generation == self.generation) [self finishSignIn:token error:exchangeError];
                }];
        });
    }];
    self.authentication.presentationContextProvider = self;
    if (self.changed) self.changed();
    if (![self.authentication start]) {
        [self finishSignIn:nil error:MSPError(@"E_AUTH", @"The system could not present Spotify sign-in.")];
    }
}

- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session {
    UIWindow *anchor = nil;
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:UIWindowScene.class]) continue;
        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
            if (window.isKeyWindow) return window;
            if (scene.activationState == UISceneActivationStateForegroundActive) anchor = window;
        }
    }
    return anchor;
}

- (void)token:(MSPTokenCompletion)completion {
    if (!self.configured) {
        completion(nil, MSPError(@"E_CONFIG", @"Set the Spotify application Client ID before signing in."));
    } else if (self.storageError) {
        completion(nil, self.storageError);
    } else if (self.accessToken.length && self.expiresAt > NSDate.date.timeIntervalSince1970 * 1000 + 30000) {
        completion(self.accessToken, nil);
    } else if (!self.refreshToken.length) {
        completion(nil, MSPError(@"E_AUTH", @"Sign in to Spotify to load your music."));
    } else {
        [self.refreshWaiters addObject:[completion copy]];
        if (self.refreshing) return;
        self.refreshing = YES;
        [self exchange:@{@"grant_type": @"refresh_token", @"client_id": self.clientId, @"refresh_token": self.refreshToken}
            completion:^(NSString *token, NSError *error) {
                NSArray<MSPTokenCompletion> *waiters = [self.refreshWaiters copy];
                [self.refreshWaiters removeAllObjects];
                self.refreshing = NO;
                for (MSPTokenCompletion waiter in waiters) waiter(token, error);
            }];
    }
}

- (void)cancelSignIn {
    if (!self.signingIn) return;
    self.generation++;
    [self.authentication cancel];
    [self finishSignIn:nil error:MSPError(@"E_CANCELLED", @"Spotify sign-in was cancelled.")];
}

- (void)clearTokens {
    SecItemDelete((__bridge CFDictionaryRef)[self keychainQuery]);
    self.accessToken = nil;
    self.refreshToken = nil;
    self.expiresAt = 0;
    self.storageError = nil;
    self.revision++;
}

- (void)signOut {
    [self cancelSignIn];
    self.generation++;
    [self clearTokens];
    if (self.changed) self.changed();
}

@end
