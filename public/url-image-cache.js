(function () {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', function () {
        navigator.serviceWorker.getRegistrations().then(function (registrations) {
            return Promise.all(registrations
                .filter(function (registration) {
                    var worker = registration.active || registration.waiting || registration.installing;
                    return worker &&
                        new URL(worker.scriptURL).pathname === '/url-image-cache-worker.js';
                })
                .map(function (registration) { return registration.unregister(); }));
        }).then(function () {
            return caches.delete('bts-url-images-v1');
        }).catch(function () {});
    });
}());
