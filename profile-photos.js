const { z } = require('zod');
const { usernamePattern } = require('./public/profile-photos');

const usernameSchema = z.string().regex(usernamePattern);
const optionalUsernameSchema = usernameSchema.optional().catch(undefined);

// Only the trusted OIDC username chooses a live author's photo (the website
// keys photos by username; email is never consulted, since not every account is on bath.ac.uk). Missing or
// invalid usernames keep initials rather than guessing another person's photo.
function usernameFromClaims(claims) {
    const username = usernameSchema.safeParse(claims?.preferred_username);
    return username.success ? username.data : undefined;
}

module.exports = { optionalUsernameSchema, usernameFromClaims };
