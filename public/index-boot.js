// Open the chat before first paint on desktop, so it doesn't squeeze the page
// sideways after it appears: open unless this browser last closed it there
// (saved by index.js). Values and content are restored by index.js.
{
    let saved = null;
    try { saved = localStorage.getItem('shitposts-open'); } catch (e) { /* storage unavailable */ }
    document.documentElement.classList.toggle('chat-open', matchMedia('(min-width: 1100px)').matches && saved !== '0');
}
