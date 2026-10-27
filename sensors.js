// sensors.js: what the spirit can "perceive" (read-only)
const { app, powerMonitor } = require('electron');
const fs = require('fs');
const os = require('os');

function desktopFiles() {
    try {
        return fs.readdirSync(app.getPath('desktop'))
            .filter(n => !n.startsWith('.'))
            .slice(0, 8);
    } catch { return []; }   // e.g. macOS permission denied
}

function read() {
    const d = new Date();
    return {
        username: os.userInfo().username,
        time: d.toTimeString().slice(0, 5),
        desktopFiles: desktopFiles(),
        idleSeconds: powerMonitor.getSystemIdleTime()
    };
}

module.exports = { read };