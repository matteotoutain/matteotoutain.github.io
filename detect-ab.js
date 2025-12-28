var DetectAb = function (callback, extended) {
    const bait = document.createElement('div');
    bait.innerHTML = '&nbsp;';
    bait.className = 'ad-wrapper ad-box';
    bait.setAttribute('aria-hidden', 'true');
    bait.style.position = 'fixed';
    bait.style.top = '200%';
    document.body.appendChild(bait);
    window.setTimeout(() => {
        if (!!bait && (bait.offsetHeight === 0 || window.getComputedStyle(bait)?.display === 'none')) {
            callback(true, 1);
        } else {
            if (extended) {
                fetch('https://www3.doubleclick.net', {
                    method: 'HEAD',
                    mode: 'no-cors',
                    cache: 'no-store',
                }).catch(() => {
                }).then((r) => {
                    r ? callback(false, 0) : callback(true, 2);
                });
            } else {
                callback(false, 0)
            }
        }
        bait.remove();
    }, 200);
}
