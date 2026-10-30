// icons.js: OS-flavoured fake icons, drawn as inline SVG (no image files).
// They are original drawings in the spirit of each OS, not copies of the official icon sets.
// Platform keys: 'mac' | 'win' | 'linux'
(function () {
    // Gradients, defined once in the page so every icon can reference them
    const DEFS = `
    <linearGradient id="gMacFolder" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8fd6ff"/><stop offset="1" stop-color="#3a9bec"/>
    </linearGradient>
    <linearGradient id="gWinFolder" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#f7b82e"/>
    </linearGradient>
    <linearGradient id="gLinFolder" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#86b6ee"/><stop offset="1" stop-color="#5a92d8"/>
    </linearGradient>
    <linearGradient id="gLinPage" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e6e6ec"/>
    </linearGradient>`;

    // Call once at startup: puts the gradients into the page
    function install() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '0');
        svg.setAttribute('height', '0');
        svg.style.position = 'absolute';
        svg.innerHTML = '<defs>' + DEFS + '</defs>';
        document.body.appendChild(svg);
    }

    const OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">';

    // Text lines on a document page: [y, width]
    const LINES = [[78, 76], [98, 76], [118, 58], [138, 76], [158, 44]];
    const lines = (x, fill, h = 6) =>
        '<g fill="' + fill + '">' +
        LINES.map(([y, w]) => '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="' + h / 2 + '"/>').join('') +
        '</g>';

    // ---- Text file ----
    function file(os) {
        if (os === 'win') {
            return OPEN +
                '<path d="M46 12H118L158 52V188H46Z" fill="#ffffff" stroke="#a9b4c4" stroke-width="2" stroke-linejoin="round"/>' +
                '<path d="M118 12V52H158Z" fill="#dbe6f5" stroke="#a9b4c4" stroke-width="2" stroke-linejoin="round"/>' +
                lines(60, '#6b9bd1') + '</svg>';
        }
        if (os === 'linux') {
            return OPEN +
                '<path d="M50 12H120L158 50V180a8 8 0 0 1-8 8H50a8 8 0 0 1-8-8V20a8 8 0 0 1 8-8Z" fill="url(#gLinPage)" stroke="#b9b9c2" stroke-width="2"/>' +
                '<path d="M120 12V42a8 8 0 0 0 8 8H158Z" fill="#d3d3da" stroke="#b9b9c2" stroke-width="2" stroke-linejoin="round"/>' +
                lines(60, '#8d8d96') + '</svg>';
        }
        // macOS
        return OPEN +
            '<path d="M52 12H122L160 50V178a10 10 0 0 1-10 10H52a10 10 0 0 1-10-10V22a10 10 0 0 1 10-10Z" fill="#fbfbfd" stroke="#c4c4cc" stroke-width="2"/>' +
            '<path d="M122 12V40a10 10 0 0 0 10 10H160Z" fill="#e3e3e9" stroke="#c4c4cc" stroke-width="2" stroke-linejoin="round"/>' +
            lines(62, '#c9c9d1') + '</svg>';
    }

    // ---- Folder ----
    const FOLDER_BACK = 'M18 50a12 12 0 0 1 12-12H76a10 10 0 0 1 8 4l8 10H170a12 12 0 0 1 12 12V152a12 12 0 0 1-12 12H30a12 12 0 0 1-12-12Z';

    function folder(os) {
        if (os === 'win') {
            return OPEN +
                '<path d="' + FOLDER_BACK + '" fill="#dfa11a"/>' +
                '<rect x="18" y="70" width="164" height="94" rx="8" fill="url(#gWinFolder)"/></svg>';
        }
        if (os === 'linux') {
            return OPEN +
                '<path d="' + FOLDER_BACK + '" fill="#3f6fb0"/>' +
                '<rect x="18" y="70" width="164" height="94" rx="10" fill="url(#gLinFolder)"/></svg>';
        }
        // macOS
        return OPEN +
            '<path d="' + FOLDER_BACK + '" fill="#3d9be9"/>' +
            '<rect x="18" y="70" width="164" height="94" rx="12" fill="url(#gMacFolder)"/></svg>';
    }

    // ---- Icon inside the fake system error box ----
    function error(os) {
        if (os === 'mac') {
            return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">' +
                '<path d="M24 4L46 42H2Z" fill="#ffcc00" stroke="#d9a800" stroke-width="2" stroke-linejoin="round"/>' +
                '<rect x="22" y="17" width="4" height="13" rx="2" fill="#333"/>' +
                '<circle cx="24" cy="35" r="2.4" fill="#333"/></svg>';
        }
        return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
            '<circle cx="16" cy="16" r="15" fill="' + (os === 'win' ? '#d32f2f' : '#e01b24') + '"/>' +
            '<path d="M10 10L22 22M22 10L10 22" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>';
    }

    window.Icons = { install, file, folder, error };
})();