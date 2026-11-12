// SPDX-License-Identifier: GPL-3.0-only
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

typedef void (^MSPTokenCompletion)(NSString *_Nullable token, NSError *_Nullable error);

NSError *MSPError(NSString *code, NSString *message);
NSString *MSPErrorText(NSError *error);

/// Spotify Authorization Code + PKCE. Refresh tokens remain in the Keychain;
/// the NSH-facing token method returns only a short-lived access token.
@interface MSPOAuth : NSObject
@property(nonatomic, copy, readonly) NSString *clientId;
@property(nonatomic, copy, readonly) NSString *redirectUri;
@property(nonatomic, readonly) BOOL configured;
@property(nonatomic, readonly) BOOL signedIn;
@property(nonatomic, readonly) BOOL signingIn;
@property(nonatomic, readonly) NSTimeInterval expiresAt;
@property(nonatomic, readonly) NSUInteger revision;
@property(nonatomic, copy, nullable) void (^changed)(void);
- (void)configure:(NSString *)clientId redirectUri:(NSString *)redirectUri;
- (void)signIn:(MSPTokenCompletion)completion;
- (void)token:(MSPTokenCompletion)completion;
- (void)cancelSignIn;
- (void)signOut;
@end

NS_ASSUME_NONNULL_END
