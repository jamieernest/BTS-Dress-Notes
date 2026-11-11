// The BTS website stores 500x500 JPEGs by BUCS username (Users/User.php).
// This is an identifier allowlist, not an HTML sanitizer; rendering uses DOMPurify.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ProfilePhotos = factory();
}(typeof self !== 'undefined' ? self : this, function () {
    const usernamePattern = /^[a-z0-9_][a-z0-9_.]{0,99}$/i;
    function validUsername(value) { return typeof value === 'string' && usernamePattern.test(value); }
    function imageUrl(username) {
        return validUsername(username) ? `https://www.bts-crew.com/images/profiles/${encodeURIComponent(username)}.jpg` : '';
    }
    return { usernamePattern, validUsername, imageUrl };
}));
