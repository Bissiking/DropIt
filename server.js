// DropIt - server.js
import express from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;
const uploadDir = "./uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `${randomUUID()}_${file.originalname}`)
});

const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 * 1024 } // 20Go max
});

app.set("trust proxy", true);
app.get("/", (req, res) => {
    res.sendFile(path.resolve("./public/index.html"));
});

// Upload (plusieurs fichiers)
app.post("/upload", upload.array("file"), (req, res) => {
    // Détection automatique du protocole + host envoyé par le client
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const links = req.files.map(f => `${baseUrl}/download/${path.basename(f.filename)}`);
    res.json({ links });
});


// Download
app.get("/download/:id", (req, res) => {
    const filePath = path.join(uploadDir, req.params.id);
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).send("Fichier introuvable");
    }
});

// UI
app.use(express.static("public"));

// 🧹 Nettoyage des fichiers > 24h
const MAX_AGE = 24 * 60 * 60 * 1000; // 24h en ms

function cleanOldFiles() {
    fs.readdir(uploadDir, (err, files) => {
        if (err) return console.error("Erreur lecture uploads:", err);

        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            fs.stat(filePath, (err, stats) => {
                if (err) return console.error("Erreur stat:", err);

                const now = Date.now();
                if (now - stats.mtimeMs > MAX_AGE) {
                    fs.unlink(filePath, (err) => {
                        if (err) console.error("Erreur suppression:", err);
                        else console.log(`🗑️ Supprimé : ${file}`);
                    });
                }
            });
        });
    });
}

// lancer toutes les heures
setInterval(cleanOldFiles, 60 * 60 * 1000);
// lancer aussi au démarrage
cleanOldFiles();

app.listen(PORT, () => console.log(`🚀 DropIt running at http://localhost:${PORT}`));