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
        <title>AR IPTV - By Hussain</title>
        <style>
            body { background-color: #0b0b0b; color: white; font-family: sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
            .container { background: #1a1a1a; padding: 30px; border-radius: 12px; width: 100%; max-width: 450px; text-align: center; border: 1px solid #333; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            h2 { margin-bottom: 20px; color: #fff; }
            .tabs { display: flex; justify-content: center; margin-bottom: 20px; background: #252525; border-radius: 25px; padding: 5px; }
            .tab { flex: 1; padding: 10px; cursor: pointer; border-radius: 20px; font-weight: bold; transition: 0.3s; color: #aaa; }
            .tab.active { background: #6a0dad; color: white; }
            .form-group { display: none; }
            .form-group.active { display: block; }
            input { width: 100%; padding: 12px; margin: 8px 0; border-radius: 6px; border: 1px solid #333; background: #252525; color: white; box-sizing: border-box; }
            button { width: 100%; padding: 14px; margin-top: 20px; border-radius: 6px; border: none; background: linear-gradient(135deg, #6a0dad, #8a2be2); color: white; font-weight: bold; cursor: pointer; transition: 0.2s; }
            button:hover { transform: scale(1.02); opacity: 0.9; }
            .logo { width: 60px; margin-bottom: 10px; }
        </style>
    </head>
    <body>
        <div class="container">
            <img src="https://stremio.com/website/stremio-logo-small.png" class="logo">
            <h2>AR IPTV Setup</h2>
            <p style="color: #888; font-size: 0.9em;">By Hussain</p>
            
            <div class="tabs">
                <div class="tab active" onclick="switchTab('xtream')">Xtream Codes</div>
                <div class="tab" onclick="switchTab('m3u')">M3U Playlist</div>
            </div>

            <div id="xtream-form" class="form-group active">
                <input type="text" id="host" placeholder="Host URL (http://domain.com:8080)">
                <input type="text" id="user" placeholder="Username">
                <input type="password" id="pass" placeholder="Password">
            </div>

            <div id="m3u-form" class="form-group">
                <input type="text" id="m3uUrl" placeholder="Paste your M3U URL here">
            </div>

            <button onclick="generateLink()">🚀 Install on Stremio</button>
        </div>

        <script>
            let currentMode = 'xtream';
            function switchTab(mode) {
                currentMode = mode;
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.form-group').forEach(f => f.classList.remove('active'));
                event.target.classList.add('active');
                document.getElementById(mode + '-form').classList.add('active');
            }
            function generateLink() {
                let config = {};
                if (currentMode === 'xtream') {
                    let host = document.getElementById('host').value.trim();
                    let user = document.getElementById('user').value.trim();
                    let pass = document.getElementById('pass').value.trim();
                    if (!host || !user || !pass) return alert("Please fill all Xtream fields");
                    if (host.endsWith('/')) host = host.slice(0, -1);
                    if (!host.startsWith('http')) host = 'http://' + host;
                    config = { mode: 'xtream', host, user, pass };
                } else {
                    let url = document.getElementById('m3uUrl').value.trim();
                    if (!url) return alert("Please paste the M3U URL");
                    config = { mode: 'm3u', url };
                }
                
                let configStr = btoa(JSON.stringify(config));
                configStr = configStr.replace(/\\//g, '_').replace(/\\+/g, '-').replace(/=/g, '');
                
                const finalUrl = 'stremio://' + window.location.host + '/' + configStr + '/manifest.json';
                window.location.href = finalUrl;
            }
        </script>
    </body>
    </html>
    `);
});

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
        const idA = Number(a.stream_id || a.series_id || 0);
        const idB = Number(b.stream_id || b.series_id || 0);
        return idB - idA;
    });
}

function parseM3U(m3uContent) {
    const lines = m3uContent.split('\n');
    const items = [];
    let currentItem = {};
    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#EXTINF')) {
            const info = line.substring(8);
            const groupMatch = info.match(/group-title="([^"]*)"/);
            const nameParts = info.split(',');
            currentItem.name = nameParts[nameParts.length - 1].trim();
            currentItem.group = groupMatch ? groupMatch[1] : "Uncategorized";
            const logoMatch = info.match(/tvg-logo="([^"]*)"/);
            currentItem.logo = logoMatch ? logoMatch[1] : null;
        } else if (line.startsWith('http')) {
            currentItem.url = line;
            if (line.match(/\.(mp4|mkv|avi|mov)$/i)) currentItem.type = 'movie';
            else currentItem.type = 'tv';
            items.push(currentItem);
            currentItem = {};
        }
    }
    // هنا لا نعكس الترتيب فوراً، سنتركه لدالة sortItems لاحقاً
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
            const [liveRes, vodRes, serRes] = await Promise.all([
                axios.get(`${config.host}/player_api.php?username=${config.user}&password=${config.pass}&action=get_live_categories`, { timeout: 4500 }).catch(e => ({ data: [] })),
                axios.get(`${config.host}/player_api.php?username=${config.user}&password=${config.pass}&action=get_vod_categories`, { timeout: 4500 }).catch(e => ({ data: [] })),
                axios.get(`${config.host}/player_api.php?username=${config.user}&password=${config.pass}&action=get_series_categories`, { timeout: 4500 }).catch(e => ({ data: [] }))
            ]);
            
            if (Array.isArray(liveRes.data)) liveGenres = liveRes.data.map(c => c.category_name);
            if (Array.isArray(vodRes.data)) movieGenres = vodRes.data.map(c => c.category_name);
            if (Array.isArray(serRes.data)) seriesGenres = serRes.data.map(c => c.category_name);

        } else if (config.mode === 'm3u') {
            const response = await axios.get(config.url, { timeout: 8000 });
            const items = parseM3U(response.data);
            const groups = [...new Set(items.map(i => i.group))].sort();
            liveGenres = groups;
            movieGenres = groups;
        }
    } catch (e) { }

    const manifest = {
        id: "org.ariptv.hussain.final",
        version: "1.0.1",
        name: "AR IPTV - By Hussain",
        description: "Advanced IPTV player for Stremio. Supports Xtream Codes & M3U playlists with auto-sorting (newest first), fast server-side search, and smart category filtering.",
        resources: ["catalog", "meta", "stream"],
        types: ["tv", "movie", "series"],
        catalogs: [
            { type: "tv", id: "iptv-live", name: "Live TV", extra: [{ name: "genre", options: liveGenres }, { name: "search" }, { name: "skip" }] },
            { type: "movie", id: "iptv-vod", name: "Movies", extra: [{ name: "genre", options: movieGenres }, { name: "search" }, { name: "skip" }] }
        ],
        idPrefixes: ["xtream:", "m3u:"]
    };

    if (config.mode === 'xtream') {
        manifest.catalogs.push({ 
            type: "series", 
            id: "iptv-series", 
            name: "TV Shows", 
            extra: [{ name: "genre", options: seriesGenres }, { name: "search" }, { name: "skip" }] 
        });
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json(manifest);
});

async function handleCatalog(req, res) {
    const config = getConfig(req);
    const { type, id, extra } = req.params;
    
    let extraObj = {};
    if (extra) {
        try {
            if (extra.includes('=')) {
                const params = new URLSearchParams(extra);
                extraObj.genre = params.get('genre');
                extraObj.search = params.get('search');
                extraObj.skip = parseInt(params.get('skip')) || 0;
            } else {
                extraObj.search = extra; 
            }
        } catch(e) {}
    }

    try {
        let metas = [];

        if (config.mode === 'xtream') {
            let action = '';
            let catAction = '';

            if (type === 'tv') { action = 'get_live_streams'; catAction = 'get_live_categories'; }
            else if (type === 'movie') { action = 'get_vod_streams'; catAction = 'get_vod_categories'; }
            else if (type === 'series') { action = 'get_series'; catAction = 'get_series_categories'; }

            if (extraObj.search) {
                const searchTerm = encodeURIComponent(extraObj.search);
                const searchUrl = `${config.host}/player_api.php?username=${config.user}&password=${config.pass}&action=${action}&search=${searchTerm}`;
                
                try {
                    const searchRes = await axios.get(searchUrl, { timeout: 8000 });
                    if (Array.isArray(searchRes.data) && searchRes.data.length > 0) {
                        metas = searchRes.data.filter(item => 
                            item.name && item.name.toLowerCase().includes(extraObj.search.toLowerCase())
                        );
                    } 
                } catch(err) { }
            } else {
                let categoryId = null;
                if (extraObj.genre && extraObj.genre !== "All") {
                    const catRes = await axios.get(`${config.host}/player_api.php?username=${config.user}&password=${config.pass}&action=${catAction}`, { timeout: 4500 });
                    if (Array.isArray(catRes.data)) {
                        const target = catRes.data.find(c => c.category_name === extraObj.genre);
                        if (target) categoryId = target.category_id;
                    }
                }

                let apiUrl = `${config.host}/player_api.php?username=${config.user}&password=${config.pass}&action=${action}`;
                if (categoryId) apiUrl += `&category_id=${categoryId}`;

                const response = await axios.get(apiUrl, { timeout: 9000 });
                metas = Array.isArray(response.data) ? response.data : [];
            }

            // === هنا التعديل: الترتيب فقط للأفلام والمسلسلات ===
            if (metas.length > 0) {
                if (type === 'movie' || type === 'series') {
                    metas = sortItems(metas);
                }
            }

            metas = metas.map(item => ({
                id: type === 'series' ? `xtream:series:${item.series_id}` 
                    : (type === 'movie' ? `xtream:movie:${item.stream_id}:${item.container_extension}` 
                    : `xtream:live:${item.stream_id}`),
                type: type,
                name: item.name,
                poster: item.stream_icon || item.cover,
                posterShape: type === 'movie' || type === 'series' ? 'poster' : 'square'
            }));
        } 
        else if (config.mode === 'm3u') {
            const response = await axios.get(config.url, { timeout: 9000 });
            let items = parseM3U(response.data);

            if (type === 'tv') items = items.filter(i => i.type === 'tv');
            else if (type === 'movie') items = items.filter(i => i.type === 'movie');

            if (extraObj.genre && extraObj.genre !== "All") items = items.filter(i => i.group === extraObj.genre);
            if (extraObj.search) items = items.filter(i => i.name.toLowerCase().includes(extraObj.search.toLowerCase()));

            // ترتيب M3U فقط للأفلام
            if (type === 'movie') {
                items = items.reverse(); 
            }

            metas = items.map((item, index) => ({
                id: `m3u:${index}:${btoa(item.url)}`,
                type: type,
                name: item.name,
                poster: item.logo,
                posterShape: 'square'
            }));
        }

        const skip = extraObj.skip || 0;
        const limit = 100;
        const finalMetas = metas.slice(skip, skip + limit);

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Cache-Control', 'max-age=60'); 
        res.json({ metas: finalMetas });

    } catch (e) {
        res.json({ metas: [] });
    }
}

app.get('/:config/catalog/:type/:id.json', handleCatalog);
app.get('/:config/catalog/:type/:id/:extra.json', handleCatalog);

app.get('/:config/meta/:type/:id.json', async (req, res) => {
    const config = getConfig(req);
    const { type, id } = req.params;
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (id.startsWith('m3u:')) {
        return res.json({ meta: { id, type, name: "Watch Stream", description: "M3U Stream" } });
    }

    if (type === 'series' && id.startsWith('xtream:')) {
        try {
            const parts = id.split(':');
            const seriesId = parts[2];
            const url = `${config.host}/player_api.php?username=${config.user}&password=${config.pass}&action=get_series_info&series_id=${seriesId}`;
            const resp = await axios.get(url, { timeout: 8000 });
            const info = resp.data;
            let videos = [];
            if (info.episodes) {
                Object.values(info.episodes).forEach(season => {
                    season.forEach(ep => {
                        videos.push({
                            id: `xtream:episode:${ep.id}:${ep.container_extension}`,
                            title: ep.title || `Ep ${ep.episode_num}`,
                            season: parseInt(ep.season),
                            episode: parseInt(ep.episode_num),
                            released: new Date().toISOString()
                        });
                    });
                });
            }
            videos.sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
            
            return res.json({ meta: { 
                id: id, type: 'series', name: info.info.name, poster: info.info.cover, description: info.info.plot, videos: videos 
            }});
        } catch(e) { return res.json({ meta: { id, type, name: "Error Info" } }); }
    }
    res.json({ meta: { id, type, name: "Watch Now" } });
});

app.get('/:config/stream/:type/:id.json', async (req, res) => {
    const config = getConfig(req);
    const parts = req.params.id.split(':');
    let streamUrl = "";
    if (req.params.id.startsWith('m3u:')) {
        try { streamUrl = atob(parts[2]); } catch(e){}
    } else {
        if (parts[1] === 'live') streamUrl = `${config.host}/${config.user}/${config.pass}/${parts[2]}`;
        else if (parts[1] === 'movie') streamUrl = `${config.host}/movie/${config.user}/${config.pass}/${parts[2]}.${parts[3]}`;
        else if (parts[1] === 'episode') streamUrl = `${config.host}/series/${config.user}/${config.pass}/${parts[2]}.${parts[3]}`;
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.json({ streams: [{ title: "Stream", url: streamUrl }] });
});

const port = process.env.PORT || 7000;
if (process.env.VERCEL) module.exports = app;
else app.listen(port, () => console.log(`Run: http://localhost:${port}`));