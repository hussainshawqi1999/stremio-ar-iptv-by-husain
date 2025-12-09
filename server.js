const express = require('express');
const axios = require('axios');
const cors = require('cors');
const { addonBuilder } = require('stremio-addon-sdk');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>IPTV Fix V10</title>
        <style>
            body { background-color: #0f0f0f; color: white; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .container { background: #1a1a1a; padding: 40px; border-radius: 16px; width: 90%; max-width: 480px; text-align: center; border: 1px solid #333; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            h2 { margin: 0 0 20px 0; color: #4ade80; }
            .tabs { display: flex; gap: 10px; margin-bottom: 20px; background: #222; padding: 5px; border-radius: 8px; }
            .tab { flex: 1; padding: 10px; cursor: pointer; border-radius: 6px; font-weight: bold; color: #888; transition: 0.3s; }
            .tab.active { background: #4ade80; color: #000; }
            .form-group { display: none; text-align: left; }
            .form-group.active { display: block; }
            label { display: block; margin: 10px 0 5px; color: #ccc; font-size: 0.9em; }
            input { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid #444; background: #222; color: white; box-sizing: border-box; font-size: 1em; }
            input:focus { border-color: #4ade80; outline: none; }
            button { width: 100%; padding: 15px; margin-top: 25px; border-radius: 8px; border: none; background: #4ade80; color: #000; font-weight: bold; font-size: 1.1em; cursor: pointer; transition: 0.2s; }
            button:hover { background: #22c55e; transform: translateY(-2px); }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>⚡ IPTV V10 (Stream Fix)</h2>
            <div class="tabs">
                <div class="tab active" onclick="switchTab('xtream')">Xtream Codes</div>
                <div class="tab" onclick="switchTab('m3u')">M3U Playlist</div>
            </div>
            <div id="xtream-form" class="form-group active">
                <label>Host URL</label>
                <input type="text" id="host" placeholder="http://server.com:8080">
                <label>Username</label>
                <input type="text" id="user" placeholder="Username">
                <label>Password</label>
                <input type="text" id="pass" placeholder="Password">
            </div>
            <div id="m3u-form" class="form-group">
                <label>M3U Link</label>
                <input type="text" id="m3uUrl" placeholder="Paste link...">
            </div>
            <button onclick="install()">🚀 Install Addon</button>
        </div>
        <script>
            let mode = 'xtream';
            function switchTab(m) {
                mode = m;
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.form-group').forEach(f => f.classList.remove('active'));
                event.target.classList.add('active');
                document.getElementById(m + '-form').classList.add('active');
            }
            function install() {
                let config = {};
                if (mode === 'xtream') {
                    let host = document.getElementById('host').value.trim();
                    let user = document.getElementById('user').value.trim();
                    let pass = document.getElementById('pass').value.trim();
                    if (!host || !user || !pass) return alert("Fill all fields");
                    if (!host.startsWith('http')) host = 'http://' + host;
                    config = { mode: 'xtream', host, user, pass };
                } else {
                    let url = document.getElementById('m3uUrl').value.trim();
                    if (!url) return alert("Paste a link");
                    try {
                        let u = new URL(url);
                        let p = new URLSearchParams(u.search);
                        if (p.get('username') && p.get('password')) {
                            config = { mode: 'xtream', host: u.origin, user: p.get('username'), pass: p.get('password') };
                        } else {
                            config = { mode: 'm3u', url };
                        }
                    } catch (e) { config = { mode: 'm3u', url }; }
                }
                let str = btoa(JSON.stringify(config)).replace(/\\//g, '_').replace(/\\+/g, '-').replace(/=/g, '');
                window.location.href = 'stremio://' + window.location.host + '/' + str + '/manifest.json';
            }
        </script>
    </body>
    </html>
    `);
});

const AXIOS_CONFIG = {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36' },
    timeout: 15000 
};

function getConfig(req) {
    try {
        return JSON.parse(atob(req.params.config.replace(/_/g, '/').replace(/-/g, '+')));
    } catch (e) { return null; }
}

function sortItems(items) {
    if (!Array.isArray(items)) return [];
    return items.sort((a, b) => Number(b.stream_id || 0) - Number(a.stream_id || 0));
}

function parseM3U(content) {
    const lines = content.split('\n');
    const items = [];
    let current = {};
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#EXTINF')) {
            const info = line.substring(8);
            const nameParts = info.split(',');
            current.name = nameParts[nameParts.length - 1].trim();
            current.group = (info.match(/group-title="([^"]*)"/) || [])[1] || "Other";
            current.logo = (info.match(/tvg-logo="([^"]*)"/) || [])[1] || null;
        } else if (line.startsWith('http')) {
            current.url = line;
            current.type = line.match(/\.(mp4|mkv|avi)$/i) ? 'movie' : 'tv';
            items.push(current);
            current = {};
        }
    }
    return items;
}

app.get('/:config/manifest.json', async (req, res) => {
    const config = getConfig(req);
    if (!config) return res.status(400).send("Invalid");

    let liveGenres = ["All"], movieGenres = ["All"], seriesGenres = ["All"];

    try {
        if (config.mode === 'xtream') {
            const base = `${config.host}/player_api.php?username=${config.user}&password=${config.pass}`;
            const [l, v, s] = await Promise.all([
                axios.get(`${base}&action=get_live_categories`, AXIOS_CONFIG).catch(() => ({ data: [] })),
                axios.get(`${base}&action=get_vod_categories`, AXIOS_CONFIG).catch(() => ({ data: [] })),
                axios.get(`${base}&action=get_series_categories`, AXIOS_CONFIG).catch(() => ({ data: [] }))
            ]);
            if (Array.isArray(l.data)) liveGenres = l.data.map(c => c.category_name);
            if (Array.isArray(v.data)) movieGenres = v.data.map(c => c.category_name);
            if (Array.isArray(s.data)) seriesGenres = s.data.map(c => c.category_name);
        } else if (config.mode === 'm3u') {
            const { data } = await axios.get(config.url, AXIOS_CONFIG);
            const groups = [...new Set(parseM3U(data).map(i => i.group))].sort();
            liveGenres = groups; movieGenres = groups;
        }
    } catch (e) {}

    const manifest = {
        id: "org.iptv.v10",
        version: "1.1.0",
        name: "IPTV Pro V10",
        description: "Fixed Stream Playback",
        resources: ["catalog", "meta", "stream"],
        types: ["tv", "movie", "series"],
        catalogs: [
            { type: "tv", id: "live", name: "Live TV", extra: [{ name: "genre", options: liveGenres }, { name: "search" }] },
            { type: "movie", id: "vod", name: "Movies", extra: [{ name: "genre", options: movieGenres }, { name: "search" }] }
        ],
        idPrefixes: ["xtream:", "m3u:"]
    };

    if (config.mode === 'xtream') {
        manifest.catalogs.push({ type: "series", id: "series", name: "Series", extra: [{ name: "genre", options: seriesGenres }, { name: "search" }] });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(manifest);
});

app.get('/:config/catalog/:type/:id/:extra?.json', async (req, res) => {
    const config = getConfig(req);
    const { type, extra } = req.params;
    let genre = "All", search = null;

    if (extra) {
        const p = new URLSearchParams(extra);
        genre = p.get('genre') || "All";
        search = p.get('search') || (extra.includes('=') ? null : extra);
    }

    let metas = [];
    try {
        if (config.mode === 'xtream') {
            const base = `${config.host}/player_api.php?username=${config.user}&password=${config.pass}`;
            let act = '', catAct = '';
            
            if (type === 'tv') { act = 'get_live_streams'; catAct = 'get_live_categories'; }
            else if (type === 'movie') { act = 'get_vod_streams'; catAct = 'get_vod_categories'; }
            else if (type === 'series') { act = 'get_series'; catAct = 'get_series_categories'; }

            if (search) {
                const { data } = await axios.get(`${base}&action=${act}&search=${encodeURIComponent(search)}`, AXIOS_CONFIG);
                if (Array.isArray(data)) metas = data;
            } else {
                let catId = "";
                if (genre !== "All") {
                    const c = await axios.get(`${base}&action=${catAct}`, AXIOS_CONFIG);
                    const t = c.data.find(x => x.category_name === genre);
                    if (t) catId = `&category_id=${t.category_id}`;
                }
                const { data } = await axios.get(`${base}&action=${act}${catId}`, AXIOS_CONFIG);
                if (Array.isArray(data)) metas = data;
            }

            if (type !== 'tv') metas = sortItems(metas);

            metas = metas.map(i => ({
                id: type === 'series' ? `xtream:series:${i.series_id}` : (type === 'movie' ? `xtream:movie:${i.stream_id}:${i.container_extension}` : `xtream:live:${i.stream_id}`),
                type, name: i.name, poster: i.stream_icon || i.cover,
                posterShape: type === 'tv' ? 'square' : 'poster'
            }));

        } else if (config.mode === 'm3u') {
            const { data } = await axios.get(config.url, AXIOS_CONFIG);
            let items = parseM3U(data);
            if (type === 'tv') items = items.filter(i => i.type === 'tv');
            else items = items.filter(i => i.type === 'movie');

            if (search) items = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
            else if (genre !== "All") items = items.filter(i => i.group === genre);

            metas = items.map((i, idx) => ({
                id: `m3u:${idx}:${btoa(i.url)}`, type, name: i.name, poster: i.logo, posterShape: 'square'
            }));
        }
        res.json({ metas: metas.slice(0, 100) });
    } catch (e) { res.json({ metas: [] }); }
});

app.get('/:config/meta/:type/:id.json', async (req, res) => {
    const config = getConfig(req);
    const { type, id } = req.params;
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (id.startsWith('m3u:')) return res.json({ meta: { id, type, name: "Stream" } });

    if (type === 'series' && id.startsWith('xtream:')) {
        try {
            const sid = id.split(':')[2];
            const { data } = await axios.get(`${config.host}/player_api.php?username=${config.user}&password=${config.pass}&action=get_series_info&series_id=${sid}`, AXIOS_CONFIG);
            let videos = [];
            if (data.episodes) {
                Object.values(data.episodes).forEach(season => {
                    season.forEach(ep => {
                        videos.push({
                            id: `xtream:episode:${ep.id}:${ep.container_extension}`,
                            title: ep.title, season: parseInt(ep.season), episode: parseInt(ep.episode_num), released: new Date().toISOString()
                        });
                    });
                });
            }
            return res.json({ meta: { id, type, name: data.info.name, poster: data.info.cover, description: data.info.plot, videos: videos.sort((a, b) => a.season - b.season || a.episode - b.episode) }});
        } catch(e) {}
    }
    res.json({ meta: { id, type, name: "Channel" } });
});

app.get('/:config/stream/:type/:id.json', (req, res) => {
    const config = getConfig(req);
    const parts = req.params.id.split(':');
    let url = "";

    if (req.params.id.startsWith('m3u:')) {
        url = atob(parts[2]);
    } else {
        const base = `${config.host}`;
        if (parts[1] === 'live') {
            url = `${base}/live/${config.user}/${config.pass}/${parts[2]}.ts`;
        }
        else if (parts[1] === 'movie') {
            url = `${base}/movie/${config.user}/${config.pass}/${parts[2]}.${parts[3]}`;
        }
        else if (parts[1] === 'episode') {
            url = `${base}/series/${config.user}/${config.pass}/${parts[2]}.${parts[3]}`;
        }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ 
        streams: [{ 
            title: "📺 Watch Stream", 
            url: url,
            behaviorHints: {
                notWebReady: true, 
                bingeGroup: "tv"
            }
        }] 
    });
});

const port = process.env.PORT || 7000;
if (process.env.VERCEL) module.exports = app;
else app.listen(port, () => console.log(`Running on ${port}`));
