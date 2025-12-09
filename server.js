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
        <title>AR IPTV Setup</title>
        <style>
            body { background-color: #0f0f0f; color: white; font-family: 'Segoe UI', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .container { background: #1a1a1a; padding: 40px; border-radius: 16px; width: 90%; max-width: 500px; text-align: center; border: 1px solid #333; box-shadow: 0 20px 50px rgba(0,0,0,0.5); }
            h2 { margin: 0 0 20px 0; color: #4ade80; }
            p { color: #aaa; font-size: 0.9em; margin-bottom: 30px; }
            
            .input-box { margin-bottom: 20px; text-align: left; }
            label { display: block; margin-bottom: 8px; color: #ccc; font-weight: bold; font-size: 0.9em; }
            input { width: 100%; padding: 14px; border-radius: 8px; border: 1px solid #444; background: #222; color: white; box-sizing: border-box; font-size: 1em; transition: 0.3s; }
            input:focus { border-color: #4ade80; outline: none; background: #2a2a2a; }

            .detected-info { display: none; background: #222; padding: 15px; border-radius: 8px; border: 1px dashed #555; margin-top: 15px; text-align: left; font-size: 0.85em; color: #bbb; }
            .detected-info strong { color: #fff; }
            .detected-info.visible { display: block; }

            button { width: 100%; padding: 16px; margin-top: 25px; border-radius: 8px; border: none; background: #4ade80; color: #000; font-weight: bold; font-size: 1.1em; cursor: pointer; transition: 0.2s; }
            button:hover { background: #22c55e; transform: translateY(-2px); }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>⚡ IPTV Smart Setup</h2>
            <p>Paste your M3U link below. We will extract the Host, Username & Password automatically.</p>
            
            <div class="input-box">
                <label>Paste M3U Link or Host URL</label>
                <input type="text" id="smartInput" placeholder="http://host:port/get.php?username=...&password=...">
            </div>

            <div id="infoBox" class="detected-info">
                <div><strong>Mode:</strong> <span id="dispMode">-</span></div>
                <div><strong>Host:</strong> <span id="dispHost">-</span></div>
                <div><strong>User:</strong> <span id="dispUser">-</span></div>
            </div>

            <button onclick="installAddon()">🚀 Install on Stremio</button>
        </div>

        <script>
            const input = document.getElementById('smartInput');
            const infoBox = document.getElementById('infoBox');
            let config = {};

            input.addEventListener('input', () => {
                const val = input.value.trim();
                if (!val) { infoBox.classList.remove('visible'); return; }

                try {
                    let urlStr = val;
                    if (!urlStr.startsWith('http')) urlStr = 'http://' + urlStr;
                    
                    const u = new URL(urlStr);
                    const params = new URLSearchParams(u.search);

                    const user = params.get('username');
                    const pass = params.get('password');

                    if (user && pass) {
                        config = {
                            mode: 'xtream',
                            host: u.origin, 
                            user: user,
                            pass: pass
                        };
                        
                        document.getElementById('dispMode').innerText = "✅ Xtream Codes (Detected)";
                        document.getElementById('dispHost').innerText = u.origin;
                        document.getElementById('dispUser').innerText = user;
                        document.getElementById('dispMode').style.color = '#4ade80';
                        infoBox.classList.add('visible');
                    } else {
                        config = { mode: 'm3u', url: val };
                        document.getElementById('dispMode').innerText = "📄 Standard M3U Playlist";
                        document.getElementById('dispHost').innerText = "N/A";
                        document.getElementById('dispUser').innerText = "N/A";
                        document.getElementById('dispMode').style.color = '#aaa';
                        infoBox.classList.add('visible');
                    }
                } catch (e) {
                    infoBox.classList.remove('visible');
                }
            });

            function installAddon() {
                if (!config.mode) return alert("Please paste a valid link first!");
                
                let configStr = btoa(JSON.stringify(config));
                configStr = configStr.replace(/\\//g, '_').replace(/\\+/g, '-').replace(/=/g, '');
                
                const protocol = window.location.protocol.replace('http', 'stremio');
                const finalUrl = \`\${protocol}//\${window.location.host}/\${configStr}/manifest.json\`;
                
                window.location.href = finalUrl;
            }
        </script>
    </body>
    </html>
    `);
});

const AXIOS_CONFIG = {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': '*/*'
    },
    timeout: 10000 
};

function getConfig(req) {
    try {
        let str = req.params.config;
        str = str.replace(/_/g, '/').replace(/-/g, '+');
        return JSON.parse(atob(str));
    } catch (e) { return null; }
}

function sortItems(items) {
    if (!Array.isArray(items)) return [];
    return items.sort((a, b) => {
        return Number(b.stream_id || 0) - Number(a.stream_id || 0);
    });
}

function parseM3U(content) {
    const lines = content.split('\n');
    const items = [];
    let current = {};
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#EXTINF')) {
            const info = line.substring(8);
            const group = info.match(/group-title="([^"]*)"/);
            const logo = info.match(/tvg-logo="([^"]*)"/);
            const nameParts = info.split(',');
            
            current.name = nameParts[nameParts.length - 1].trim();
            current.group = group ? group[1] : "Other";
            current.logo = logo ? logo[1] : null;
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
    if (!config) return res.status(400).send("Invalid Config");

    let liveGenres = ["All"];
    let movieGenres = ["All"];
    let seriesGenres = ["All"];

    try {
        if (config.mode === 'xtream') {
            const baseApi = `${config.host}/player_api.php?username=${config.user}&password=${config.pass}`;
            
            const [live, vod, ser] = await Promise.all([
                axios.get(`${baseApi}&action=get_live_categories`, AXIOS_CONFIG).catch(() => ({ data: [] })),
                axios.get(`${baseApi}&action=get_vod_categories`, AXIOS_CONFIG).catch(() => ({ data: [] })),
                axios.get(`${baseApi}&action=get_series_categories`, AXIOS_CONFIG).catch(() => ({ data: [] }))
            ]);

            if (Array.isArray(live.data)) liveGenres = live.data.map(c => c.category_name);
            if (Array.isArray(vod.data)) movieGenres = vod.data.map(c => c.category_name);
            if (Array.isArray(ser.data)) seriesGenres = ser.data.map(c => c.category_name);
        
        } else if (config.mode === 'm3u') {
            const res = await axios.get(config.url, AXIOS_CONFIG);
            const items = parseM3U(res.data);
            const groups = [...new Set(items.map(i => i.group))].sort();
            liveGenres = groups;
            movieGenres = groups;
        }
    } catch (e) { console.log("Manifest Error:", e.message); }

    const manifest = {
        id: "org.iptv.fixed.v8",
        version: "1.0.8",
        name: "IPTV Pro (Fixed)",
        description: "Optimized for Xtream Codes & M3U",
        resources: ["catalog", "meta", "stream"],
        types: ["tv", "movie", "series"],
        idPrefixes: ["xtream:", "m3u:"],
        catalogs: [
            { type: "tv", id: "live", name: "Live TV", extra: [{ name: "genre", options: liveGenres }, { name: "search" }] },
            { type: "movie", id: "vod", name: "Movies", extra: [{ name: "genre", options: movieGenres }, { name: "search" }] }
        ]
    };

    if (config.mode === 'xtream') {
        manifest.catalogs.push({ 
            type: "series", id: "series", name: "Series", 
            extra: [{ name: "genre", options: seriesGenres }, { name: "search" }] 
        });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(manifest);
});

app.get('/:config/catalog/:type/:id/:extra?.json', async (req, res) => {
    const config = getConfig(req);
    const { type, extra } = req.params;
    let genre = "All";
    let search = null;

    if (extra) {
        try {
            const params = new URLSearchParams(extra);
            if (params.get('genre')) genre = params.get('genre');
            if (params.get('search')) search = params.get('search');
        } catch(e) { search = extra; }
    }

    let metas = [];

    try {
        if (config.mode === 'xtream') {
            const baseApi = `${config.host}/player_api.php?username=${config.user}&password=${config.pass}`;
            let action = '';
            let catAction = '';

            if (type === 'tv') { action = 'get_live_streams'; catAction = 'get_live_categories'; }
            else if (type === 'movie') { action = 'get_vod_streams'; catAction = 'get_vod_categories'; }
            else if (type === 'series') { action = 'get_series'; catAction = 'get_series_categories'; }

            if (search) {
                const url = `${baseApi}&action=${action}&search=${encodeURIComponent(search)}`;
                const { data } = await axios.get(url, AXIOS_CONFIG);
                if (Array.isArray(data)) metas = data;
            } else {
                let catId = "";
                if (genre !== "All") {
                    const cats = await axios.get(`${baseApi}&action=${catAction}`, AXIOS_CONFIG);
                    const target = cats.data.find(c => c.category_name === genre);
                    if (target) catId = `&category_id=${target.category_id}`;
                }
                
                const url = `${baseApi}&action=${action}${catId}`;
                const { data } = await axios.get(url, AXIOS_CONFIG);
                if (Array.isArray(data)) metas = data;
            }

            if (type !== 'tv') metas = sortItems(metas);

            metas = metas.map(item => ({
                id: type === 'series' ? `xtream:series:${item.series_id}` 
                    : (type === 'movie' ? `xtream:movie:${item.stream_id}:${item.container_extension}` 
                    : `xtream:live:${item.stream_id}`),
                type: type,
                name: item.name,
                poster: item.stream_icon || item.cover,
                posterShape: type === 'tv' ? 'square' : 'poster'
            }));

        } else if (config.mode === 'm3u') {
            const { data } = await axios.get(config.url, AXIOS_CONFIG);
            let items = parseM3U(data);
            
            if (type === 'tv') items = items.filter(i => i.type === 'tv');
            else items = items.filter(i => i.type === 'movie');

            if (search) items = items.filter(i => i.name.toLowerCase().includes(search.toLowerCase()));
            else if (genre !== "All") items = items.filter(i => i.group === genre);

            metas = items.map((item, idx) => ({
                id: `m3u:${idx}:${btoa(item.url)}`,
                type: type,
                name: item.name,
                poster: item.logo,
                posterShape: 'square'
            }));
        }

        res.json({ metas: metas.slice(0, 100) });

    } catch (e) {
        console.log("Catalog Error:", e.message);
        res.json({ metas: [] });
    }
});

app.get('/:config/meta/:type/:id.json', async (req, res) => {
    const config = getConfig(req);
    const { type, id } = req.params;

    if (id.startsWith('m3u:')) {
        return res.json({ meta: { id, type, name: "Stream", description: "IPTV Stream" } });
    }

    if (type === 'series' && id.startsWith('xtream:')) {
        try {
            const seriesId = id.split(':')[2];
            const url = `${config.host}/player_api.php?username=${config.user}&password=${config.pass}&action=get_series_info&series_id=${seriesId}`;
            const { data } = await axios.get(url, AXIOS_CONFIG);
            
            let videos = [];
            if (data.episodes) {
                Object.values(data.episodes).forEach(season => {
                    season.forEach(ep => {
                        videos.push({
                            id: `xtream:episode:${ep.id}:${ep.container_extension}`,
                            title: ep.title,
                            season: parseInt(ep.season),
                            episode: parseInt(ep.episode_num),
                            released: new Date().toISOString()
                        });
                    });
                });
            }
            
            return res.json({ meta: {
                id, type, 
                name: data.info.name, 
                poster: data.info.cover, 
                description: data.info.plot, 
                videos: videos.sort((a, b) => a.season - b.season || a.episode - b.episode)
            }});
        } catch(e) {}
    }

    res.json({ meta: { id, type, name: "Watch Channel" } });
});

app.get('/:config/stream/:type/:id.json', (req, res) => {
    const config = getConfig(req);
    const parts = req.params.id.split(':');
    let url = "";

    if (req.params.id.startsWith('m3u:')) {
        url = atob(parts[2]);
    } else {
        const base = `${config.host}`;
        if (parts[1] === 'live') url = `${base}/${config.user}/${config.pass}/${parts[2]}`;
        else if (parts[1] === 'movie') url = `${base}/movie/${config.user}/${config.pass}/${parts[2]}.${parts[3]}`;
        else if (parts[1] === 'episode') url = `${base}/series/${config.user}/${config.pass}/${parts[2]}.${parts[3]}`;
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ streams: [{ title: "Stream", url: url }] });
});

const port = process.env.PORT || 7000;
if (process.env.VERCEL) module.exports = app;
else app.listen(port, () => console.log(`Run: http://localhost:${port}`));
