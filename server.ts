import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import { db } from "./src/db.js";
import "dotenv/config";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "8695643247:AAHJcX4SfuXPs8e7uPzfvtwUBB-bjlF2l00";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "-1003584372702";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to parse JSON
  app.use(express.json());

  // Configure multer (memory storage) with 10MB limit
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 }
  });

  // Upload endpoint
  app.post("/api/upload-image", (req, res, next) => {
    upload.single("image")(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: "حجم الصورة كبير جداً (الحد الأقصى 10 ميجابايت)" });
        }
        return res.status(400).json({ error: err.message });
      }
      next();
    });
  }, async (req, res) => {
    try {
      const { user_id, image_title } = req.body;
      const file = req.file;

      if (!file || !user_id || !image_title) {
        return res.status(400).json({ error: "Missing required fields or file" });
      }

      // Upload to Telegram
      const formData = new FormData();
      formData.append("chat_id", TELEGRAM_CHAT_ID);
      
      const blob = new Blob([file.buffer], { type: file.mimetype });
      formData.append("photo", blob, file.originalname);

      const telegramRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendPhoto`, {
        method: "POST",
        body: formData,
      });

      const telegramData = await telegramRes.json();

      if (!telegramData.ok) {
        if (telegramData.error_code === 401) {
          throw new Error("عذراً، توكن بوت تيليجرام غير صالح (Unauthorized). يرجى التأكد من صحة التوكن وتحديثه في إعدادات البيئة (Environment Variables) في الموقع.");
        }
        throw new Error(telegramData.description || "Failed to upload to Telegram");
      }

      // Extract largest photo file_id
      const photos = telegramData.result.photo;
      const largestPhoto = photos[photos.length - 1];
      const telegram_file_id = largestPhoto.file_id;

      // Save to Turso
      const id = crypto.randomUUID();
      await db.execute({
        sql: "INSERT INTO images (id, user_id, image_title, telegram_file_id, created_at) VALUES (?, ?, ?, ?, ?)",
        args: [id, user_id, image_title, telegram_file_id, Date.now()],
      });

      res.json({ success: true, id, telegram_file_id });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Get user images
  app.get("/api/images", async (req, res) => {
    try {
      const { user_id } = req.query;
      if (!user_id) {
        return res.status(400).json({ error: "Missing user_id parameter" });
      }

      const result = await db.execute({
        sql: "SELECT * FROM images WHERE user_id = ? ORDER BY created_at DESC",
        args: [user_id as string],
      });

      res.json({ images: result.rows });
    } catch (error: any) {
      console.error("Fetch images error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Get actual file URL from Telegram
  app.get("/api/image-url/:file_id", async (req, res) => {
    try {
      const { file_id } = req.params;
      
      const telegramRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${file_id}`);
      const telegramData = await telegramRes.json();

      if (!telegramData.ok) {
        throw new Error(telegramData.description || "Failed to get file from Telegram");
      }

      const filePath = telegramData.result.file_path;
      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
      
      res.json({ url: fileUrl });
    } catch (error: any) {
      console.error("Fetch image URL error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
