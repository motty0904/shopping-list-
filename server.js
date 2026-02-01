import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'items.json');
const DIST_DIR = path.join(__dirname, 'dist');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(bodyParser.json());

// 静的ファイルの配信 (Build後のファイルを配信)
if (fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR));
}

// 接続設定の取得 (QRコード用)
app.get('/api/config', (req, res) => {
    const interfaces = os.networkInterfaces();
    let ip = '127.0.0.1';
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ip = iface.address;
                break;
            }
        }
    }
    const hostname = os.hostname().endsWith('.local') ? os.hostname() : os.hostname() + '.local';
    res.json({
        ip,
        hostname,
        port: PORT
    });
});

// データの読み込み
const loadData = () => {
    if (fs.existsSync(DATA_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    return [];
};

// データの保存
const saveData = (data) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
};

// API エンドポイント
app.get('/api/items', (req, res) => {
    res.json(loadData());
});

app.post('/api/items', (req, res) => {
    saveData(req.body);
    res.json({ success: true });
});

// SPA用のキャッチオール (どのルートにもマッチしなかった場合に index.html を返す)
app.use((req, res) => {
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.send('App is not built yet. Please run npm run build.');
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Sync server + Frontend running on http://0.0.0.0:${PORT}`);
});
