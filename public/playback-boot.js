if (['source', 'show', 'file', 'demo'].some(key => new URLSearchParams(location.search).has(key))) {
    document.documentElement.classList.add('opening-playback');
}
