const { z } = require('zod');
const { usernamePattern } = require('./public/profile-photos');

const usernameSchema = z.string().regex(usernamePattern);
const optionalUsernameSchema = usernameSchema.optional().catch(undefined);
const bathEmailSchema = z.email().max(254).refine(value => value.split('@')[1].toLowerCase() === 'bath.ac.uk');

// Only trusted OIDC/session claims choose a live author's photo. The website
// keys photos by username, not by a user's editable contact email. Missing or
// invalid usernames keep initials rather than guessing another person's photo.
function usernameFromClaims(claims) {
    const email = bathEmailSchema.safeParse(claims?.email);
    if (!email.success) return undefined;
    const candidate = claims.preferred_username;
    const username = usernameSchema.safeParse(candidate);
    return username.success ? username.data : undefined;
}

module.exports = { optionalUsernameSchema, usernameFromClaims };
