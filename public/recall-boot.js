// Runs in <head>, before the page is first drawn: when the address opens a
// saved show, swap the file chooser for loading placeholders at once rather
// than flashing it while recall.js fetches the show (it removes the class).
if (new URLSearchParams(location.search).has('show')) {
    document.documentElement.classList.add('opening-show');
}
