// Open the chat before first paint on desktop, so it doesn't squeeze the page
// sideways after it appears. Values and content are restored by index.js.
document.documentElement.classList.toggle('chat-open', matchMedia('(min-width: 1100px)').matches);
