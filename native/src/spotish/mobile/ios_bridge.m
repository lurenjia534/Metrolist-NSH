// SPDX-License-Identifier: GPL-3.0-only
#import "ios_bridge.h"
#import "ios_auth.h"
#import <SpotifyiOS/SpotifyiOS.h>
#import <UIKit/UIKit.h>

typedef void (^MSPConnection)(NSError *_Nullable error);
static NSString *const MSPRemoteAuthorizationKey = @"metrolist.spotify.remote-authorization";

static NSString *json(id object) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:object options:NSJSONWritingFragmentsAllowed error:nil];
    return [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
}

@interface MSPRemote : NSObject <SPTAppRemoteDelegate, SPTAppRemotePlayerStateDelegate, SPTAppRemoteUserAPIDelegate>
@property(nonatomic) MSPReply reply;
@property(nonatomic) MSPEvent event;
@property(nonatomic, strong) MSPOAuth *oauth;
@property(nonatomic, strong) SPTAppRemote *remote;
@property(nonatomic, strong) id<SPTAppRemotePlayerState> playerState;
@property(nonatomic, strong) NSMutableDictionary *player;
@property(nonatomic, strong) NSNumber *onDemand;
@property(nonatomic, copy) NSString *artworkIdentifier;
@property(nonatomic, copy) NSString *artwork;
@property(nonatomic, copy) NSString *healthStatus;
@property(nonatomic, strong) NSDictionary *healthError;
@property(nonatomic, strong) NSMutableArray<MSPConnection> *connections;
@property(nonatomic) BOOL active;
@property(nonatomic) BOOL connecting;
@property(nonatomic) BOOL preparingToken;
@property(nonatomic) BOOL wakeOnFailure;
@property(nonatomic) BOOL waitingForSpotify;
@property(nonatomic) NSUInteger generation;
@property(nonatomic, copy) NSString *wakeURI;
@property(nonatomic, copy) NSString *remoteAccessToken;
- (NSDictionary *)snapshot;
- (void)publish;
- (void)request:(uint64_t)requestId method:(NSString *)method parameters:(NSDictionary *)parameters;
@end

@implementation MSPRemote

- (instancetype)init {
    self = [super init];
    if (self) {
        _oauth = [MSPOAuth new];
        _connections = [NSMutableArray array];
        _player = [NSMutableDictionary dictionary];
        _healthStatus = @"ready";
        _wakeURI = @"";
        NSDictionary *pending = [NSUserDefaults.standardUserDefaults dictionaryForKey:MSPRemoteAuthorizationKey];
        _waitingForSpotify = [pending[@"clientId"] isEqualToString:_oauth.clientId] &&
                             [pending[@"redirectUri"] isEqualToString:_oauth.redirectUri];
        __weak MSPRemote *weakSelf = self;
        _oauth.changed = ^{ [weakSelf publish]; };
        [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(didBecomeActive:)
            name:UIApplicationDidBecomeActiveNotification object:nil];
        [NSNotificationCenter.defaultCenter addObserver:self selector:@selector(willResignActive:)
            name:UIApplicationWillResignActiveNotification object:nil];
    }
    return self;
}

- (NSDictionary *)snapshot {
    BOOL configured = self.oauth.configured;
    NSString *status = !configured ? @"failed" : self.oauth.signingIn || self.waitingForSpotify ? @"signingIn" : self.healthStatus;
    id error = !configured ? @{@"code": @"E_CONFIG", @"message": @"Set the Spotify application Client ID to connect this iPhone."}
                           : self.healthError ?: NSNull.null;
    return @{@"player": self.player,
             @"health": @{@"status": status, @"error": error},
             @"signedIn": @(self.oauth.signedIn),
             @"authRevision": @(self.oauth.revision),
             @"configuration": @{@"clientId": self.oauth.clientId, @"redirectUri": self.oauth.redirectUri,
                                  @"configured": @(configured)},
             @"capabilities": @{@"volume": @NO, @"lyrics": @YES, @"onDemand": self.onDemand ?: NSNull.null},
             @"deviceId": @""};
}

- (void)publish {
    if (self.event) self.event(json([self snapshot]).UTF8String);
}

- (void)answer:(uint64_t)requestId value:(id)value {
    self.reply(requestId, true, json(value ?: NSNull.null).UTF8String);
}

- (void)reject:(uint64_t)requestId error:(NSError *)error {
    self.reply(requestId, false, MSPErrorText(error).UTF8String);
}

- (void)setFailure:(NSError *)error {
    self.healthStatus = @"failed";
    self.healthError = @{@"code": error.userInfo[@"spotifyCode"] ?: @"E_CONNECTION", @"message": error.localizedDescription};
}

- (void)finishConnections:(NSError *)error {
    self.connecting = NO;
    self.preparingToken = NO;
    self.wakeOnFailure = NO;
    self.waitingForSpotify = NO;
    [NSUserDefaults.standardUserDefaults removeObjectForKey:MSPRemoteAuthorizationKey];
    NSArray<MSPConnection> *callbacks = [self.connections copy];
    [self.connections removeAllObjects];
    for (MSPConnection callback in callbacks) callback(error);
}

- (void)createRemote {
    if (self.remote) return;
    SPTConfiguration *configuration = [[SPTConfiguration alloc] initWithClientID:self.oauth.clientId
        redirectURL:[NSURL URLWithString:self.oauth.redirectUri]];
    self.remote = [[SPTAppRemote alloc] initWithConfiguration:configuration logLevel:SPTAppRemoteLogLevelError];
    self.remote.delegate = self;
}

- (void)connect:(BOOL)wake uri:(NSString *)uri completion:(MSPConnection)completion {
    if (!self.active) {
        completion(MSPError(@"E_INACTIVE", @"Switch to Spotify before starting playback."));
        return;
    }
    if (self.remote.isConnected) { completion(nil); return; }
    [self.connections addObject:[completion copy]];
    self.wakeOnFailure = self.wakeOnFailure || wake;
    if (!self.connecting || uri.length) self.wakeURI = uri;
    if (self.connecting) return;
    self.connecting = YES;
    if (self.waitingForSpotify) { [self publish]; return; }
    self.preparingToken = YES;
    self.healthStatus = @"starting";
    self.healthError = nil;
    NSUInteger generation = self.generation;
    [self publish];
    MSPTokenCompletion connectWithToken = ^(NSString *token, NSError *error) {
        if (generation != self.generation) return;
        self.preparingToken = NO;
        if (error) {
            [self setFailure:error];
            [self finishConnections:error];
            [self publish];
            return;
        }
        [self createRemote];
        // Keep the SDK token obtained by its app-switch authorization for
        // reconnects. The independent PKCE token still serves the Web API.
        self.remote.connectionParameters.accessToken = token;
        if (UIApplication.sharedApplication.applicationState == UIApplicationStateActive) [self.remote connect];
    };
    if (self.remoteAccessToken.length) connectWithToken(self.remoteAccessToken, nil);
    else [self.oauth token:connectWithToken];
}

- (void)didBecomeActive:(NSNotification *)notification {
    if (!self.active || !self.oauth.signedIn || self.oauth.signingIn || self.waitingForSpotify || self.preparingToken) return;
    if (self.connecting && self.remote.connectionParameters.accessToken.length) {
        [self.remote connect];
    } else if (!self.remote.isConnected) {
        [self connect:NO uri:@"" completion:^(NSError *error) {}];
    }
}

- (void)willResignActive:(NSNotification *)notification {
    if (self.remote.isConnected) [self.remote disconnect];
}

- (void)appRemoteDidEstablishConnection:(SPTAppRemote *)remote {
    if (remote != self.remote) return;
    if (!self.active || UIApplication.sharedApplication.applicationState != UIApplicationStateActive) {
        [remote disconnect];
        return;
    }
    self.healthStatus = @"ready";
    self.healthError = nil;
    remote.playerAPI.delegate = self;
    remote.userAPI.delegate = self;
    [remote.playerAPI subscribeToPlayerState:^(id result, NSError *error) {
        if (remote != self.remote) return;
        if (error) {
            [self setFailure:MSPError(@"E_CONNECTION", error.localizedDescription)];
            [self publish];
        } else if ([result conformsToProtocol:@protocol(SPTAppRemotePlayerState)]) {
            [self playerStateDidChange:result];
        }
    }];
    [remote.playerAPI getPlayerState:^(id result, NSError *error) {
        if (remote == self.remote && !error && result) [self playerStateDidChange:result];
    }];
    [remote.userAPI subscribeToCapabilityChanges:nil];
    [remote.userAPI fetchCapabilitiesWithCallback:^(id result, NSError *error) {
        if (remote == self.remote && !error && result) [self userAPI:remote.userAPI didReceiveCapabilities:result];
    }];
    [self finishConnections:nil];
    [self publish];
}

- (void)appRemote:(SPTAppRemote *)remote didFailConnectionAttemptWithError:(NSError *)error {
    if (remote != self.remote || !self.active) return;
    if (self.wakeOnFailure) {
        // App Remote needs the Spotify app awake. Its supported wake-up
        // flow switches to Spotify; the normal NSH UrlScheme callback
        // supplies the SDK's own App Remote token on return.
        self.wakeOnFailure = NO;
        self.waitingForSpotify = YES;
        [NSUserDefaults.standardUserDefaults setObject:
            @{@"clientId": self.oauth.clientId, @"redirectUri": self.oauth.redirectUri}
            forKey:MSPRemoteAuthorizationKey];
        [self publish];
        [remote authorizeAndPlayURI:self.wakeURI completionHandler:^(BOOL opened) {
            if (remote != self.remote || !self.waitingForSpotify) return;
            if (!opened) {
                NSError *missing = MSPError(@"E_SPOTIFY_NOT_INSTALLED", @"Install Spotify on this iPhone, sign in there, then try again.");
                [self setFailure:missing];
                [self finishConnections:missing];
                [self publish];
            }
        }];
        return;
    }
    NSError *failure = MSPError(@"E_CONNECTION", error.localizedDescription ?: @"Spotify could not establish an App Remote connection.");
    [self setFailure:failure];
    [self finishConnections:failure];
    [self publish];
}

- (void)appRemote:(SPTAppRemote *)remote didDisconnectWithError:(NSError *)error {
    if (remote != self.remote) return;
    if (error && self.active && UIApplication.sharedApplication.applicationState == UIApplicationStateActive) {
        NSError *failure = MSPError(@"E_CONNECTION", error.localizedDescription);
        [self setFailure:failure];
        [self finishConnections:failure];
    } else if (!self.connecting) {
        self.healthStatus = @"ready";
        self.healthError = nil;
    }
    [self publish];
}

- (void)userAPI:(id<SPTAppRemoteUserAPI>)userAPI didReceiveCapabilities:(id<SPTAppRemoteUserCapabilities>)capabilities {
    if (userAPI != self.remote.userAPI) return;
    self.onDemand = @(capabilities.canPlayOnDemand);
    [self publish];
}

- (void)playerStateDidChange:(id<SPTAppRemotePlayerState>)state {
    if (!self.remote.isConnected) return;
    self.playerState = state;
    id<SPTAppRemoteTrack> track = state.track;
    id<SPTAppRemotePlaybackRestrictions> restrictions = state.playbackRestrictions;
    SPTAppRemotePlaybackOptionsRepeatMode repeat = state.playbackOptions.repeatMode;
    BOOL sameImage = [self.artworkIdentifier isEqualToString:track.imageIdentifier];
    [self.player addEntriesFromDictionary:@{
        @"title": track.name ?: @"", @"artist": track.artist.name ?: @"", @"album": track.album.name ?: @"",
        @"artwork": sameImage ? self.artwork ?: @"" : @"", @"trackUri": track.URI ?: @"",
        @"contextUri": state.contextURI.absoluteString ?: @"", @"playing": @(!state.isPaused),
        @"positionMs": @(state.playbackPosition), @"durationMs": @(track.duration),
        @"at": @(NSDate.date.timeIntervalSince1970 * 1000), @"shuffle": @(state.playbackOptions.isShuffling),
        @"shuffleAvailable": @(restrictions.canToggleShuffle),
        @"repeat": repeat == SPTAppRemotePlaybackOptionsRepeatModeTrack ? @"track" : repeat == SPTAppRemotePlaybackOptionsRepeatModeContext ? @"context" : @"off",
        @"liked": @(track.isSaved), @"canNext": @(restrictions.canSkipNext), @"canPrevious": @(restrictions.canSkipPrevious),
        @"ad": @(track.isAdvertisement)
    }];
    [self publish];
    if (sameImage || !track.imageIdentifier.length) return;
    self.artworkIdentifier = track.imageIdentifier;
    self.artwork = @"";
    NSString *identifier = track.imageIdentifier;
    SPTAppRemote *remote = self.remote;
    [remote.imageAPI fetchImageForItem:track withSize:CGSizeMake(640, 640) callback:^(id result, NSError *error) {
        if (error || remote != self.remote || ![identifier isEqualToString:self.artworkIdentifier]) return;
        NSData *image = UIImageJPEGRepresentation(result, 0.85);
        if (!image) return;
        self.artwork = [@"data:image/jpeg;base64," stringByAppendingString:[image base64EncodedStringWithOptions:0]];
        self.player[@"artwork"] = self.artwork;
        [self publish];
    }];
}

- (void)stopConnection:(NSError *)reason {
    self.generation++;
    [self finishConnections:reason];
    self.remote.delegate = nil;
    self.remote.playerAPI.delegate = nil;
    self.remote.userAPI.delegate = nil;
    [self.remote disconnect];
    self.remote = nil;
    self.healthStatus = @"ready";
    self.healthError = nil;
}

- (void)pauseOwnedPlayback:(MSPConnection)completion {
    if (self.remote.isConnected) {
        SPTAppRemote *remote = self.remote;
        [remote.playerAPI pause:^(id result, NSError *error) {
            if (error) { completion(MSPError(@"E_PLAYBACK", error.localizedDescription)); return; }
            [remote.playerAPI getPlayerState:^(id state, NSError *stateError) {
                if (stateError) { completion(MSPError(@"E_PLAYBACK", stateError.localizedDescription)); return; }
                if (remote == self.remote) [self playerStateDidChange:state];
                completion(nil);
            }];
        }];
    } else if (self.playerState && !self.playerState.isPaused) {
        // UIKit disconnects the controller when the app is backgrounded;
        // Spotify's own audio can still be playing. Reconnect to stop it
        // before changing workspace, account, or application Client ID.
        [self connect:NO uri:@"" completion:^(NSError *error) {
            if (error) completion(error);
            else [self pauseOwnedPlayback:completion];
        }];
    } else {
        completion(nil);
    }
}

- (void)control:(uint64_t)requestId method:(NSString *)method parameters:(NSDictionary *)parameters {
    SPTAppRemote *remote = self.remote;
    SPTAppRemoteCallback done = ^(id result, NSError *error) {
        if (error) { [self reject:requestId error:MSPError(@"E_PLAYBACK", error.localizedDescription)]; return; }
        [remote.playerAPI getPlayerState:^(id state, NSError *stateError) {
            if (stateError) [self reject:requestId error:MSPError(@"E_PLAYBACK", stateError.localizedDescription)];
            else {
                if (remote == self.remote) [self playerStateDidChange:state];
                [self answer:requestId value:[self snapshot]];
            }
        }];
    };
    if ([method isEqualToString:@"play"]) [remote.playerAPI resume:done];
    else if ([method isEqualToString:@"pause"]) [remote.playerAPI pause:done];
    else if ([method isEqualToString:@"next"]) [remote.playerAPI skipToNext:done];
    else if ([method isEqualToString:@"previous"]) [remote.playerAPI skipToPrevious:done];
    else if ([method isEqualToString:@"seek"]) [remote.playerAPI seekToPosition:[parameters[@"ms"] longLongValue] callback:done];
    else if ([method isEqualToString:@"setShuffle"]) [remote.playerAPI setShuffle:[parameters[@"on"] boolValue] callback:done];
    else if ([method isEqualToString:@"setRepeat"]) {
        NSDictionary *modes = @{@"off": @(SPTAppRemotePlaybackOptionsRepeatModeOff), @"track": @(SPTAppRemotePlaybackOptionsRepeatModeTrack), @"context": @(SPTAppRemotePlaybackOptionsRepeatModeContext)};
        [remote.playerAPI setRepeatMode:[modes[parameters[@"mode"]] unsignedIntegerValue] callback:done];
    } else if ([method isEqualToString:@"toggle"]) {
        [remote.playerAPI getPlayerState:^(id result, NSError *error) {
            if (error) { done(nil, error); return; }
            id<SPTAppRemotePlayerState> state = result;
            if (state.isPaused) [remote.playerAPI resume:done];
            else [remote.playerAPI pause:done];
        }];
    } else if ([method isEqualToString:@"playTrack"]) {
        [remote.playerAPI play:parameters[@"uri"] callback:done];
    } else if ([method isEqualToString:@"playContext"]) {
        NSString *uri = parameters[@"uri"];
        NSString *track = parameters[@"trackUri"] == NSNull.null ? nil : parameters[@"trackUri"];
        if (!track.length) { [remote.playerAPI play:uri callback:done]; return; }
        NSNumber *index = parameters[@"index"];
        if (!index) {
            done(nil, MSPError(@"E_ARGUMENT", @"A track selected within a collection needs its collection index."));
            return;
        }
        [remote.contentAPI fetchContentItemForURI:uri callback:^(id result, NSError *error) {
            if (error) { done(nil, error); return; }
            id<SPTAppRemoteContentItem> context = result;
            [remote.playerAPI playItem:context skipToTrackIndex:index.integerValue callback:done];
        }];
    }
}

- (void)request:(uint64_t)requestId method:(NSString *)method parameters:(NSDictionary *)parameters {
    if ([method isEqualToString:@"snapshot"]) {
        [self answer:requestId value:[self snapshot]];
    } else if ([method isEqualToString:@"configure"]) {
        NSString *client = parameters[@"clientId"] ?: @"";
        NSString *redirect = parameters[@"redirectUri"] ?: @"metrolist-spotify://callback";
        if (![client isEqualToString:self.oauth.clientId] || ![redirect isEqualToString:self.oauth.redirectUri]) {
            [self pauseOwnedPlayback:^(NSError *error) {
                if (error) { [self reject:requestId error:error]; return; }
                [self stopConnection:MSPError(@"E_CANCELLED", @"The Spotify application configuration changed.")];
                self.remoteAccessToken = nil;
                self.player = [NSMutableDictionary dictionary];
                self.playerState = nil;
                self.onDemand = nil;
                self.artworkIdentifier = nil;
                [self.oauth configure:client redirectUri:redirect];
                [self publish];
                [self answer:requestId value:[self snapshot]];
            }];
        } else {
            [self answer:requestId value:[self snapshot]];
        }
    } else if ([method isEqualToString:@"activate"] || [method isEqualToString:@"setActive"]) {
        BOOL active = [method isEqualToString:@"activate"] || [parameters[@"active"] boolValue];
        if (!active) {
            [self pauseOwnedPlayback:^(NSError *error) {
                if (error) { [self reject:requestId error:error]; return; }
                self.active = NO;
                [self stopConnection:MSPError(@"E_INACTIVE", @"The Spotify workspace is inactive.")];
                [self publish];
                [self answer:requestId value:[self snapshot]];
            }];
        } else {
            self.active = YES;
            if (self.oauth.signedIn) [self connect:NO uri:@"" completion:^(NSError *error) {}];
            [self publish];
            [self answer:requestId value:[self snapshot]];
        }
    } else if ([method isEqualToString:@"token"]) {
        [self.oauth token:^(NSString *token, NSError *error) {
            if (error) [self reject:requestId error:error];
            else [self answer:requestId value:@{@"accessToken": token, @"expiresAt": @(self.oauth.expiresAt)}];
        }];
    } else if ([method isEqualToString:@"signIn"]) {
        [self stopConnection:MSPError(@"E_CANCELLED", @"A new Spotify sign-in started.")];
        self.remoteAccessToken = nil;
        self.healthError = nil;
        [self.oauth signIn:^(NSString *token, NSError *error) {
            if (error) {
                if ([error.userInfo[@"spotifyCode"] isEqualToString:@"E_CANCELLED"]) self.healthStatus = @"ready";
                else [self setFailure:error];
                [self publish];
                [self reject:requestId error:error];
                return;
            }
            [self connect:YES uri:@"" completion:^(NSError *connectionError) {
                if (connectionError) [self reject:requestId error:connectionError];
                else [self answer:requestId value:[self snapshot]];
            }];
        }];
    } else if ([method isEqualToString:@"cancelSignIn"]) {
        [self.oauth cancelSignIn];
        if (self.waitingForSpotify || self.connecting) [self stopConnection:MSPError(@"E_CANCELLED", @"Spotify sign-in was cancelled.")];
        self.healthStatus = @"ready";
        self.healthError = nil;
        [self publish];
        [self answer:requestId value:[self snapshot]];
    } else if ([method isEqualToString:@"signOut"]) {
        void (^finish)(void) = ^{
            [self stopConnection:MSPError(@"E_CANCELLED", @"Signed out of Spotify.")];
            self.remoteAccessToken = nil;
            [self.oauth signOut];
            self.player = [NSMutableDictionary dictionary];
            self.playerState = nil;
            self.onDemand = nil;
            self.artworkIdentifier = nil;
            [self publish];
            [self answer:requestId value:[self snapshot]];
        };
        [self pauseOwnedPlayback:^(NSError *error) {
            if (error) [self reject:requestId error:error];
            else finish();
        }];
    } else if ([method isEqualToString:@"retry"]) {
        if (!self.oauth.signedIn) { [self request:requestId method:@"signIn" parameters:parameters]; return; }
        [self connect:YES uri:@"" completion:^(NSError *error) {
            if (error) [self reject:requestId error:error];
            else [self answer:requestId value:[self snapshot]];
        }];
    } else if ([method isEqualToString:@"handleURL"]) {
        NSURL *url = [NSURL URLWithString:parameters[@"url"]];
        NSURL *expected = [NSURL URLWithString:self.oauth.redirectUri];
        if (!self.waitingForSpotify || !self.oauth.configured || ![url.scheme isEqualToString:expected.scheme] ||
            ![url.host isEqualToString:expected.host] || ![(url.path ?: @"") isEqualToString:expected.path ?: @""]) {
            [self answer:requestId value:[self snapshot]];
            return;
        }
        [self createRemote];
        NSDictionary *values = [self.remote authorizationParametersFromURL:url];
        NSString *token = values[SPTAppRemoteAccessTokenKey];
        NSString *failure = values[SPTAppRemoteErrorDescriptionKey];
        if (token.length) {
            self.remoteAccessToken = token;
            self.remote.connectionParameters.accessToken = token;
            self.waitingForSpotify = NO;
            [NSUserDefaults.standardUserDefaults removeObjectForKey:MSPRemoteAuthorizationKey];
            self.healthStatus = @"starting";
            if (self.active && UIApplication.sharedApplication.applicationState == UIApplicationStateActive) [self.remote connect];
        } else if (failure.length) {
            NSError *error = MSPError(@"E_AUTH", failure);
            [self setFailure:error];
            [self finishConnections:error];
            [self publish];
            [self reject:requestId error:error];
            return;
        }
        [self publish];
        [self answer:requestId value:[self snapshot]];
    } else if ([method isEqualToString:@"setVolume"] || [method isEqualToString:@"setMuted"]) {
        [self reject:requestId error:MSPError(@"E_UNSUPPORTED", @"Use the iPhone volume buttons to change Spotify's volume.")];
    } else if ([@[@"toggle", @"play", @"pause", @"next", @"previous", @"seek", @"setShuffle", @"setRepeat", @"playContext", @"playTrack"] containsObject:method]) {
        if ([method isEqualToString:@"pause"] && !self.oauth.signedIn && !self.remote.isConnected && !self.playerState) {
            [self answer:requestId value:[self snapshot]];
            return;
        }
        BOOL wake = [@[@"play", @"toggle", @"playTrack", @"playContext"] containsObject:method];
        NSString *uri = parameters[@"uri"] ?: @"";
        [self connect:wake uri:uri completion:^(NSError *error) {
            if (error) [self reject:requestId error:error];
            else [self control:requestId method:method parameters:parameters];
        }];
    } else {
        [self reject:requestId error:MSPError(@"E_UNSUPPORTED", [NSString stringWithFormat:@"Unknown Spotify operation: %@", method])];
    }
}

@end

void metrolist_spotify_ios_request(uint64_t requestId, const char *method,
                                 const char *payload, MSPReply reply, MSPEvent event) {
    // Copy engine-thread arguments before returning across the Rust ABI.
    NSString *operation = [NSString stringWithUTF8String:method];
    NSData *data = [[NSString stringWithUTF8String:payload] dataUsingEncoding:NSUTF8StringEncoding];
    dispatch_async(dispatch_get_main_queue(), ^{
        static MSPRemote *remote;
        if (!remote) remote = [MSPRemote new];
        remote.reply = reply;
        remote.event = event;
        NSError *error = nil;
        NSDictionary *parameters = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
        if (error) reply(requestId, false, MSPErrorText(MSPError(@"E_ARGUMENT", error.localizedDescription)).UTF8String);
        else [remote request:requestId method:operation parameters:parameters ?: @{}];
    });
}
