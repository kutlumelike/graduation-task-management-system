const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
require('dotenv').config();
// ── Renkli Log Yardımcıları ──────────────────────────────────────
const log = {
  info:    (msg) => console.log(`\x1b[36m[INFO]\x1b[0m  ${msg}`),
  ok:      (msg) => console.log(`\x1b[32m[OK]\x1b[0m    ${msg}`),
  warn:    (msg) => console.log(`\x1b[33m[WARN]\x1b[0m  ${msg}`),
  error:   (msg) => console.log(`\x1b[31m[ERROR]\x1b[0m ${msg}`),
  req:     (method, path) => console.log(`\x1b[35m[REQ]\x1b[0m   ${method} ${path}`),
  body:    (data) => console.log(`\x1b[90m[BODY]\x1b[0m  ${JSON.stringify(data)}`),
  sql:     (msg) => console.log(`\x1b[34m[SQL]\x1b[0m   ${msg}`),
};

const app = express();
app.use(cors());
app.use(express.json());
// UTF-8 charset: Türkçe karakter bozulmalarının önüne geçmek için
// Sadece /uploads dışındaki API isteklerine uygula
app.use((req, res, next) => {
  if (!req.path.startsWith('/uploads')) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  next();
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Her isteği logla ─────────────────────────────────────────────
app.use((req, res, next) => {
  log.req(req.method, req.path);
  if (['POST','PUT','PATCH'].includes(req.method)) log.body(req.body);
  next();
});

// Multer Ayarları
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir);
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    let name = req.body.originalFileName || file.originalname;
    try { 
      // Frontend encodeURIComponent ile encode ederek gönderiyor,
      // burada decodeURIComponent ile orijinal Türkçe karakterlere dönüştürüyoruz.
      name = decodeURIComponent(name); 
    } catch(e) {}
    cb(null, Date.now() + '-' + name.replace(/\s+/g, '_'));
  }
});
const upload = multer({ storage });


const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: String(process.env.DB_PASSWORD),
  port: Number(process.env.DB_PORT),
});

// TABLOLARI OLUŞTUR
async function createTables() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS Users (
        Id SERIAL PRIMARY KEY,
        Name VARCHAR(100) NOT NULL,
        Email VARCHAR(150) UNIQUE NOT NULL,
        Password TEXT NOT NULL,
        Role VARCHAR(20) DEFAULT 'user'
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS Tasks (
        Id SERIAL PRIMARY KEY,
        Title VARCHAR(200) NOT NULL,
        Description TEXT,
        due_date DATE,
        Status VARCHAR(50) DEFAULT 'Bekliyor',
        category VARCHAR(100) DEFAULT 'General',
        priority VARCHAR(50) DEFAULT 'Medium',
        UserId INTEGER REFERENCES Users(Id) ON DELETE CASCADE
      );
    `);

    // Mevcut tabloları yeni yapıya uydurmak için ALTER işlemleri
    // 'duedate' (alt çizgisiz) eski addan 'due_date'e yeniden adlandır
    try {
      await pool.query('ALTER TABLE Tasks RENAME COLUMN duedate TO due_date');
      console.log('✅ duedate sütunu due_date olarak yeniden adlandırıldı.');
    } catch (e) {
      // Zaten due_date veya tablo yeni oluştu, yoksay
    }
    // 'DueDate' (büyük harf) eski addan 'due_date'e yeniden adlandır
    try {
      await pool.query('ALTER TABLE Tasks RENAME COLUMN "DueDate" TO due_date');
    } catch (e) {
      // Zaten due_date, yoksay
    }

    try {
      await pool.query("ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'General'");
      await pool.query("ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS priority VARCHAR(50) DEFAULT 'Medium'");
      await pool.query("ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS assigned_by INTEGER REFERENCES Users(Id)");
      await pool.query("ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS reminder_date TIMESTAMP");
    } catch (e) {
      console.error('Sütun ekleme hatası:', e);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS Files (
        id SERIAL PRIMARY KEY,
        task_id INTEGER REFERENCES Tasks(Id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        file_type VARCHAR(100),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS Notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES Users(Id) ON DELETE CASCADE,
        task_id INTEGER REFERENCES Tasks(Id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        type VARCHAR(50) DEFAULT 'info',
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await pool.query("ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES Tasks(Id) ON DELETE CASCADE");
      await pool.query("ALTER TABLE Notifications ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES Workspaces(id) ON DELETE CASCADE");
    } catch (e) {
      // Ignored
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS Sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER REFERENCES Users(Id) ON DELETE CASCADE,
        token TEXT,
        device_info VARCHAR(255),
        ip_address VARCHAR(45),
        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      );
    `);

    // WORKSPACE TABLES
    await pool.query(`
      CREATE TABLE IF NOT EXISTS Workspaces (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        banner_color VARCHAR(50) DEFAULT '#3b82f6',
        invite_code VARCHAR(20) UNIQUE NOT NULL,
        created_by INTEGER REFERENCES Users(Id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await pool.query("ALTER TABLE Workspaces ADD COLUMN IF NOT EXISTS allow_student_uploads BOOLEAN DEFAULT false");
    } catch (e) {
      console.error('Workspace column error:', e);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS WorkspaceMembers (
        workspace_id INTEGER REFERENCES Workspaces(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES Users(Id) ON DELETE CASCADE,
        role VARCHAR(50) DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (workspace_id, user_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS WorkspaceAnnouncements (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER REFERENCES Workspaces(id) ON DELETE CASCADE,
        content TEXT NOT NULL,
        created_by INTEGER REFERENCES Users(Id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await pool.query("ALTER TABLE Tasks ADD COLUMN IF NOT EXISTS workspace_id INTEGER REFERENCES Workspaces(id) ON DELETE CASCADE");
    } catch (e) {
      console.error('Workspace column error:', e);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS TaskAssignments (
        task_id INTEGER REFERENCES Tasks(Id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES Users(Id) ON DELETE CASCADE,
        status VARCHAR(50) DEFAULT 'Pending',
        submitted_at TIMESTAMP,
        PRIMARY KEY (task_id, user_id)
      );
    `);

    // WORKSPACE FILES TABLE
    await pool.query(`
      CREATE TABLE IF NOT EXISTS WorkspaceFiles (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER REFERENCES Workspaces(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(255) NOT NULL,
        file_type VARCHAR(100),
        uploaded_by INTEGER REFERENCES Users(Id),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    try {
      await pool.query("ALTER TABLE WorkspaceFiles ADD COLUMN IF NOT EXISTS description TEXT");
    } catch(e) {}

    // COMMENTS TABLE (for announcements and tasks)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS Comments (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER REFERENCES Workspaces(id) ON DELETE CASCADE,
        task_id INTEGER REFERENCES Tasks(Id) ON DELETE CASCADE,
        announcement_id INTEGER REFERENCES WorkspaceAnnouncements(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES Users(Id),
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Add creator_name to announcements
    try {
      await pool.query("ALTER TABLE WorkspaceAnnouncements ADD COLUMN IF NOT EXISTS title VARCHAR(200)");
    } catch(e) {}

    // WORKSPACE ACTIVITY LOG TABLE
    await pool.query(`
      CREATE TABLE IF NOT EXISTS WorkspaceActivityLog (
        id SERIAL PRIMARY KEY,
        workspace_id INTEGER REFERENCES Workspaces(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES Users(Id),
        user_name VARCHAR(100),
        action_type VARCHAR(50) NOT NULL,
        description TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log('\u2705 Users, Tasks, Files, Notifications, Sessions ve Workspace tabloları hazır!');
  } catch (err) {
    console.error('\u274C Tablo oluşturma hatası:', err);
  }
}

// TOKEN KONTROL
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token gerekli.' });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ message: 'Token geçersiz.' });
    }
    
    // Check session validity in DB
    if (user.sessionId) {
      try {
        const sessionCheck = await pool.query('SELECT is_active FROM Sessions WHERE id = $1', [user.sessionId]);
        if (sessionCheck.rowCount === 0 || !sessionCheck.rows[0].is_active) {
           return res.status(401).json({ message: 'Oturum sonlandırıldı. Lütfen tekrar giriş yapın.' });
        }
        
        // Update last active
        await pool.query('UPDATE Sessions SET last_active = CURRENT_TIMESTAMP WHERE id = $1', [user.sessionId]);
      } catch (dbErr) {
        return res.status(500).json({ message: 'Oturum doğrulanırken hata oluştu.' });
      }
    }

    req.user = user;
    req.token = token;
    next();
  });
}

// ROLE KONTROL MIDDLEWARE
function authorizeRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bu işlem için yetkiniz yok.' });
    }
    next();
  };
}

// WORKSPACE ROLE MIDDLEWARE
async function authorizeWorkspaceRole(req, res, next, ...allowedRoles) {
  try {
    const wsId = req.params.id;
    const membership = await pool.query(
      'SELECT role FROM WorkspaceMembers WHERE workspace_id = $1 AND user_id = $2',
      [wsId, req.user.userId]
    );
    if (membership.rowCount === 0) {
      return res.status(403).json({ message: 'Bu çalışma alanının üyesi değilsiniz.' });
    }
    req.workspaceRole = membership.rows[0].role;
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.workspaceRole)) {
      return res.status(403).json({ message: 'Bu işlem için yetkiniz yok.' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: 'Yetki kontrolü başarısız' });
  }
}

function wsOwnerOnly(req, res, next) {
  return authorizeWorkspaceRole(req, res, next, 'owner');
}

function wsMemberAccess(req, res, next) {
  return authorizeWorkspaceRole(req, res, next, 'owner', 'member');
}

// HELPER: Notify all workspace members except the actor
async function notifyWorkspaceMembers(workspaceId, excludeUserId, message, type) {
  try {
    const members = await pool.query(
      'SELECT user_id FROM WorkspaceMembers WHERE workspace_id = $1 AND user_id != $2',
      [workspaceId, excludeUserId]
    );
    for (const m of members.rows) {
      await pool.query(
        "INSERT INTO Notifications (user_id, message, type, workspace_id) VALUES ($1, $2, $3, $4)",
        [m.user_id, message, type, workspaceId]
      );
    }
  } catch (err) {
    console.error('notifyWorkspaceMembers error:', err.message);
  }
}

// HELPER: Log workspace activity
async function logActivity(workspaceId, userId, userName, actionType, description) {
  try {
    await pool.query(
      'INSERT INTO WorkspaceActivityLog (workspace_id, user_id, user_name, action_type, description) VALUES ($1, $2, $3, $4, $5)',
      [workspaceId, userId, userName, actionType, description]
    );
  } catch (err) {
    console.error('logActivity error:', err.message);
  }
}

// TEST
app.get('/', (req, res) => {
  res.send('Görev Yönetimi API çalışıyor ✅');
});

// KULLANICI EKLE (REGISTER)
app.post('/users', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Tüm alanları doldurunuz.' });
    }

    const userCheck = await pool.query('SELECT * FROM Users WHERE Email = $1', [email]);
    if (userCheck.rowCount > 0) {
      return res.status(400).json({ error: 'Bu email adresi zaten kullanımda.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO Users (Name, Email, Password) VALUES ($1, $2, $3) RETURNING Id, Name, Email, Role',
      [name, email, hashedPassword]
    );

    const user = result.rows[0];
    
    // Auto login
    const ipAddress = req.ip || req.connection.remoteAddress;
    const deviceInfo = req.headers['user-agent'] || 'Unknown Device';
    
    const sessionRes = await pool.query(
      'INSERT INTO Sessions (user_id, device_info, ip_address) VALUES ($1, $2, $3) RETURNING id',
      [user.id, deviceInfo, ipAddress]
    );
    const sessionId = sessionRes.rows[0].id;
    
    const token = jwt.sign(
      { userId: user.id, role: user.role, sessionId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    await pool.query('UPDATE Sessions SET token = $1 WHERE id = $2', [token, sessionId]);

    res.status(201).json({
      message: 'Kayıt ve giriş başarılı ✅',
      token,
      user
    });
  } catch (error) {
    console.error('Kullanıcı ekleme hatası:', error);
    res.status(500).json({ error: 'Kullanıcı eklenemedi' });
  }
});

// LOGIN
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await pool.query(
      'SELECT * FROM Users WHERE Email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Email veya şifre yanlış!' });
    }

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: 'Email veya şifre yanlış!' });
    }

    // Generate session ID
    const ipAddress = req.ip || req.connection.remoteAddress;
    const deviceInfo = req.headers['user-agent'] || 'Unknown Device';
    
    const sessionRes = await pool.query(
      'INSERT INTO Sessions (user_id, device_info, ip_address) VALUES ($1, $2, $3) RETURNING id',
      [user.id, deviceInfo, ipAddress]
    );
    const sessionId = sessionRes.rows[0].id;

    const token = jwt.sign(
      { userId: user.id, role: user.role, sessionId },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    await pool.query('UPDATE Sessions SET token = $1 WHERE id = $2', [token, sessionId]);

    res.json({
      message: 'Giriş başarılı ✅',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Login hatası:', error.message);
    res.status(500).json({ error: 'Giriş yapılamadı' });
  }
});

// SESSIONS ENDPOINTS
app.get('/sessions', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, device_info, ip_address, last_active, is_active FROM Sessions WHERE user_id = $1 AND is_active = true ORDER BY last_active DESC',
      [req.user.userId]
    );
    // Mark current session
    const sessions = result.rows.map(s => ({
      ...s,
      is_current: s.id === req.user.sessionId
    }));
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Oturumlar alınamadı' });
  }
});

app.post('/sessions/logout', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE Sessions SET is_active = false WHERE id = $1', [req.user.sessionId]);
    res.json({ message: 'Çıkış yapıldı' });
  } catch (error) {
    res.status(500).json({ error: 'Çıkış yapılamadı' });
  }
});

app.post('/sessions/logout-all', authenticateToken, async (req, res) => {
  try {
    await pool.query('UPDATE Sessions SET is_active = false WHERE user_id = $1 AND id != $2', [req.user.userId, req.user.sessionId]);
    res.json({ message: 'Diğer tüm cihazlardan çıkış yapıldı' });
  } catch (error) {
    res.status(500).json({ error: 'İşlem başarısız' });
  }
});

// --- WORKSPACE API ---
app.post('/workspaces', authenticateToken, async (req, res) => {
  try {
    const { title, description, banner_color } = req.body;
    const invite_code = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    const result = await pool.query(
      'INSERT INTO Workspaces (title, description, banner_color, invite_code, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title, description, banner_color || '#3b82f6', invite_code, req.user.userId]
    );
    const workspace = result.rows[0];

    await pool.query(
      'INSERT INTO WorkspaceMembers (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [workspace.id, req.user.userId, 'owner']
    );

    res.status(201).json(workspace);
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(500).json({ error: 'Çalışma alanı oluşturulamadı' });
  }
});

app.get('/workspaces', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT w.*, wm.role as my_role 
      FROM Workspaces w
      JOIN WorkspaceMembers wm ON w.id = wm.workspace_id
      WHERE wm.user_id = $1
      ORDER BY w.created_at DESC
    `, [req.user.userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Çalışma alanları alınamadı' });
  }
});

app.post('/workspaces/join', authenticateToken, async (req, res) => {
  try {
    const { invite_code } = req.body;
    
    const wsResult = await pool.query('SELECT * FROM Workspaces WHERE invite_code = $1', [invite_code]);
    if (wsResult.rows.length === 0) {
      return res.status(404).json({ message: 'Geçersiz davet kodu' });
    }
    const workspace = wsResult.rows[0];

    const checkMem = await pool.query('SELECT * FROM WorkspaceMembers WHERE workspace_id = $1 AND user_id = $2', [workspace.id, req.user.userId]);
    if (checkMem.rows.length > 0) {
      return res.status(400).json({ message: 'Zaten bu çalışma alanındasınız' });
    }

    await pool.query(
      'INSERT INTO WorkspaceMembers (workspace_id, user_id, role) VALUES ($1, $2, $3)',
      [workspace.id, req.user.userId, 'member']
    );

    res.json({ message: 'Çalışma alanına başarıyla katıldınız', workspace });
  } catch (error) {
    res.status(500).json({ error: 'Katılma işlemi başarısız' });
  }
});

app.get('/workspaces/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const checkMem = await pool.query('SELECT role FROM WorkspaceMembers WHERE workspace_id = $1 AND user_id = $2', [id, req.user.userId]);
    if (checkMem.rows.length === 0) {
      return res.status(403).json({ message: 'Bu çalışma alanına erişim izniniz yok' });
    }

    const wsResult = await pool.query('SELECT * FROM Workspaces WHERE id = $1', [id]);
    const workspace = wsResult.rows[0];
    workspace.my_role = checkMem.rows[0].role;
    
    res.json(workspace);
  } catch (error) {
    res.status(500).json({ error: 'Çalışma alanı detayları alınamadı' });
  }
});

// EDIT WORKSPACE (owner only)
app.put('/workspaces/:id', authenticateToken, wsOwnerOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, allow_student_uploads } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Sınıf adı boş olamaz.' });
    }

    const oldRes = await pool.query('SELECT allow_student_uploads FROM Workspaces WHERE id = $1', [id]);
    const oldAllow = oldRes.rows[0]?.allow_student_uploads;

    const result = await pool.query(
      'UPDATE Workspaces SET title = $1, description = $2, allow_student_uploads = $3 WHERE id = $4 RETURNING *',
      [title.trim(), description || '', allow_student_uploads || false, id]
    );

    if (allow_student_uploads === true && oldAllow !== true) {
      await notifyWorkspaceMembers(id, req.user.userId, 'Eğitmeniniz bu sınıf için dosya yüklemelerini etkinleştirdi.', 'info');
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Çalışma alanı güncellenemedi' });
  }
});

// DELETE WORKSPACE (owner only)
app.delete('/workspaces/:id', authenticateToken, wsOwnerOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM Workspaces WHERE id = $1', [id]);
    res.json({ message: 'Çalışma alanı başarıyla silindi' });
  } catch (error) {
    console.error('Delete workspace error:', error);
    res.status(500).json({ error: 'Çalışma alanı silinemedi' });
  }
});

// GET ACTIVITY LOG
app.get('/workspaces/:id/activity', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM WorkspaceActivityLog WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 30',
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Aktivite logu alınamadı' });
  }
});

// DELETE ALL ACTIVITY LOG (owner only)
app.delete('/workspaces/:id/activity', authenticateToken, wsOwnerOnly, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM WorkspaceActivityLog WHERE workspace_id = $1', [id]);
    res.json({ message: 'Tüm aktiviteler temizlendi' });
  } catch (error) {
    res.status(500).json({ error: 'Aktiviteler temizlenemedi' });
  }
});

// DELETE SINGLE ACTIVITY LOG
app.delete('/workspaces/:id/activity/:activityId', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id, activityId } = req.params;
    
    // Check ownership or if admin
    const checkRes = await pool.query('SELECT user_id FROM WorkspaceActivityLog WHERE id = $1 AND workspace_id = $2', [activityId, id]);
    if (checkRes.rowCount === 0) return res.status(404).json({ error: 'Aktivite bulunamadı' });
    
    if (req.workspaceRole !== 'owner' && checkRes.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Bu aktiviteyi silme yetkiniz yok' });
    }

    await pool.query('DELETE FROM WorkspaceActivityLog WHERE id = $1', [activityId]);
    res.json({ message: 'Aktivite silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Aktivite silinemedi' });
  }
});
// --- WORKSPACE MEMBERS ---
app.get('/workspaces/:id/members', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT wm.user_id, wm.role, wm.joined_at, u.name as user_name, u.email
      FROM WorkspaceMembers wm
      JOIN Users u ON wm.user_id = u.id
      WHERE wm.workspace_id = $1
      ORDER BY CASE wm.role WHEN 'owner' THEN 0 ELSE 1 END, wm.joined_at ASC
    `, [id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Üye listesi alınamadı' });
  }
});

app.delete('/workspaces/:id/members/:userId', authenticateToken, wsOwnerOnly, async (req, res) => {
  try {
    const { id, userId } = req.params;
    // Yöneticinin silinmesini engelle
    const checkMem = await pool.query('SELECT role FROM WorkspaceMembers WHERE workspace_id = $1 AND user_id = $2', [id, userId]);
    if (checkMem.rows.length === 0) return res.status(404).json({ error: 'Üye bulunamadı' });
    if (checkMem.rows[0].role === 'owner') return res.status(400).json({ error: 'Yönetici sınıftan çıkarılamaz' });

    await pool.query('DELETE FROM WorkspaceMembers WHERE workspace_id = $1 AND user_id = $2', [id, userId]);
    res.json({ message: 'Üye başarıyla çıkarıldı' });
  } catch (error) {
    res.status(500).json({ error: 'Üye çıkarılamadı' });
  }
});

// --- WORKSPACE ANNOUNCEMENTS ---
app.post('/workspaces/:id/announcements', authenticateToken, wsOwnerOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, title } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Duyuru içeriği gerekli.' });
    }
    const result = await pool.query(
      'INSERT INTO WorkspaceAnnouncements (workspace_id, content, title, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, content.trim(), title || null, req.user.userId]
    );
    // Get user name for activity log
    const userRes = await pool.query('SELECT name FROM Users WHERE id = $1', [req.user.userId]);
    const userName = userRes.rows[0]?.name || 'Yönetici';
    const annTitle = title || content.trim().substring(0, 50);
    // Notify members
    await notifyWorkspaceMembers(id, req.user.userId, `Yeni duyuru: "${annTitle}"`, 'announcement');
    // Log activity
    await logActivity(id, req.user.userId, userName, 'announcement', `${userName} yeni bir duyuru paylaştı: "${annTitle}"`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Announcement error:', error);
    res.status(500).json({ error: 'Duyuru oluşturulamadı' });
  }
});

app.get('/workspaces/:id/announcements', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT wa.*, u.name as creator_name
      FROM WorkspaceAnnouncements wa
      JOIN Users u ON wa.created_by = u.id
      WHERE wa.workspace_id = $1
      ORDER BY wa.created_at DESC
    `, [id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Duyurular alınamadı' });
  }
});

// --- WORKSPACE FILE UPLOAD (PDF) ---
app.post('/workspaces/:id/upload', authenticateToken, wsMemberAccess, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    
    // Permission Check
    const wsRes = await pool.query('SELECT allow_student_uploads FROM Workspaces WHERE id = $1', [id]);
    const allowStudentUploads = wsRes.rows[0]?.allow_student_uploads;
    if (req.workspaceRole !== 'owner' && !allowStudentUploads) {
      return res.status(403).json({ error: 'Öğrenci yüklemelerine izin verilmiyor.' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'Dosya yüklenemedi' });
    }
    const { originalname, filename, mimetype } = req.file;
    const { description, originalFileName } = req.body;
    const filePath = `/uploads/${filename}`;
    
    // Frontend encodeURIComponent ile encode ederek gönderiyor,
    // burada decodeURIComponent ile orijinal Türkçe karakterlere dönüştürüyoruz.
    let finalFileName = originalFileName || originalname;
    try {
      finalFileName = decodeURIComponent(finalFileName);
    } catch(e) {}

    const result = await pool.query(
      'INSERT INTO WorkspaceFiles (workspace_id, file_name, file_path, file_type, uploaded_by, description) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [id, finalFileName, filePath, mimetype, req.user.userId, description || null]
    );
    
    // Get user name for activity log
    const userRes = await pool.query('SELECT name FROM Users WHERE id = $1', [req.user.userId]);
    const userName = userRes.rows[0]?.name || 'Kullanıcı';
    
    if (req.workspaceRole === 'owner') {
      // Notify members
      await notifyWorkspaceMembers(id, req.user.userId, `Yeni dosya yüklendi: "${finalFileName}"`, 'file_upload');
    } else {
      // Notify owner(s)
      const owners = await pool.query(
        "SELECT user_id FROM WorkspaceMembers WHERE workspace_id = $1 AND role = 'owner'",
        [id]
      );
      for (const owner of owners.rows) {
        await pool.query(
          "INSERT INTO Notifications (user_id, message, type, workspace_id) VALUES ($1, $2, $3, $4)",
          [owner.user_id, `Bir üye dosya yükledi: "${finalFileName}"`, 'file_upload', id]
        );
      }
    }
    
    // Log activity
    await logActivity(id, req.user.userId, userName, 'file_uploaded', `${userName} yeni bir dosya yükledi: "${finalFileName}"`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('File upload error:', error);
    res.status(500).json({ error: 'Dosya yüklenemedi' });
  }
});

app.delete('/workspaces/:id/files/:fileId', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const fileRes = await pool.query('SELECT * FROM WorkspaceFiles WHERE id = $1 AND workspace_id = $2', [fileId, id]);
    if (fileRes.rowCount === 0) return res.status(404).json({ error: 'Dosya bulunamadı' });
    
    const file = fileRes.rows[0];
    if (req.workspaceRole !== 'owner' && file.uploaded_by !== req.user.userId) {
      return res.status(403).json({ error: 'Bu dosyayı silme yetkiniz yok' });
    }

    const absolutePath = path.join(__dirname, 'uploads', path.basename(file.file_path));
    if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    
    await pool.query('DELETE FROM WorkspaceFiles WHERE id = $1', [fileId]);
    res.json({ message: 'Dosya başarıyla silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Dosya silinemedi' });
  }
});

app.get('/workspaces/:id/files', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT wf.*, u.name as uploader_name
      FROM WorkspaceFiles wf
      JOIN Users u ON wf.uploaded_by = u.id
      WHERE wf.workspace_id = $1
      ORDER BY wf.uploaded_at DESC
    `, [id]);

    // Sadece disk üzerinde gerçekten var olan dosyaları döndür,
    // disk üzerinde olmayan kayıtları otomatik temizle (orphan cleanup)
    const validFiles = [];
    for (const file of result.rows) {
      const diskPath = path.join(__dirname, file.file_path);
      if (fs.existsSync(diskPath)) {
        validFiles.push(file);
      } else {
        // Disk üzerinde olmayan kayıtları DB'den sil
        await pool.query('DELETE FROM WorkspaceFiles WHERE id = $1', [file.id]);
        console.warn(`[CLEANUP] Disk üzerinde olmayan dosya kaydı silindi: ${file.file_path}`);
      }
    }
    res.json(validFiles);
  } catch (error) {
    res.status(500).json({ error: 'Dosyalar alınamadı' });
  }
});

// --- WORKSPACE TASKS ---
app.post('/workspaces/:id/tasks', authenticateToken, wsOwnerOnly, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, due_date, assign_to } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Görev başlığı gerekli.' });
    }

    // Create task linked to workspace
    const taskResult = await pool.query(
      `INSERT INTO Tasks (title, description, due_date, status, userid, workspace_id, assigned_by)
       VALUES ($1, $2, $3, 'Bekliyor', $4, $5, $4)
       RETURNING *`,
      [title.trim(), description || null, due_date || null, req.user.userId, id]
    );
    const task = taskResult.rows[0];

    // If assign_to is provided (array of user_ids), create assignments
    if (assign_to && Array.isArray(assign_to) && assign_to.length > 0) {
      for (const userId of assign_to) {
        await pool.query(
          'INSERT INTO TaskAssignments (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [task.id, userId]
        );
      }
    } else {
      // Assign to all members
      const members = await pool.query(
        "SELECT user_id FROM WorkspaceMembers WHERE workspace_id = $1 AND role = 'member'",
        [id]
      );
      for (const mem of members.rows) {
        await pool.query(
          'INSERT INTO TaskAssignments (task_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [task.id, mem.user_id]
        );
      }
    }

    // Get user name for notifications/activity
    const userRes = await pool.query('SELECT name FROM Users WHERE id = $1', [req.user.userId]);
    const userName = userRes.rows[0]?.name || 'Yönetici';
    // Notify members
    await notifyWorkspaceMembers(id, req.user.userId, `Yeni görev atandı: "${title.trim()}"`, 'task_assigned');
    // Log activity
    await logActivity(id, req.user.userId, userName, 'task_assigned', `${userName} yeni bir görev oluşturdu: "${title.trim()}"`);

    res.status(201).json(task);
  } catch (error) {
    console.error('Workspace task error:', error);
    res.status(500).json({ error: 'Görev oluşturulamadı' });
  }
});

app.get('/workspaces/:id/tasks', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT t.*, u.name as creator_name
      FROM Tasks t
      JOIN Users u ON t.userid = u.id
      WHERE t.workspace_id = $1
      ORDER BY t.id DESC
    `, [id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Görevler alınamadı' });
  }
});

app.delete('/workspaces/:id/tasks/:taskId', authenticateToken, wsOwnerOnly, async (req, res) => {
  try {
    const { id, taskId } = req.params;
    await pool.query('DELETE FROM Tasks WHERE id = $1 AND workspace_id = $2', [taskId, id]);
    res.json({ message: 'Görev başarıyla silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Görev silinemedi' });
  }
});

app.put('/workspaces/:id/tasks/:taskId/status', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id, taskId } = req.params;
    const { status } = req.body;
    // Get task title before update
    const taskRes = await pool.query('SELECT title FROM Tasks WHERE id = $1', [taskId]);
    await pool.query('UPDATE Tasks SET status = $1 WHERE id = $2 AND workspace_id = $3', [status, taskId, id]);
    // Log completion activity
    if (status === 'Tamamlandı' && taskRes.rows.length > 0) {
      const userRes = await pool.query('SELECT name FROM Users WHERE id = $1', [req.user.userId]);
      const userName = userRes.rows[0]?.name || 'Öğrenci';
      await logActivity(id, req.user.userId, userName, 'task_completed', `${userName} görevi tamamladı: "${taskRes.rows[0].title}"`);
    }
    res.json({ message: 'Görev durumu güncellendi' });
  } catch (error) {
    res.status(500).json({ error: 'Görev güncellenemedi' });
  }
});

// --- COMMENTS (on announcements or tasks) ---
app.post('/workspaces/:id/comments', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { content, task_id, announcement_id } = req.body;
    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Yorum içeriği gerekli.' });
    }
    const result = await pool.query(
      'INSERT INTO Comments (workspace_id, task_id, announcement_id, user_id, content) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [id, task_id || null, announcement_id || null, req.user.userId, content.trim()]
    );
    // Get user name
    const userRes = await pool.query('SELECT name FROM Users WHERE id = $1', [req.user.userId]);
    const userName = userRes.rows[0]?.name || 'Biri';
    // Notify members
    await notifyWorkspaceMembers(id, req.user.userId, `${userName} yorum yaptı.`, 'comment');
    // Log activity
    await logActivity(id, req.user.userId, userName, 'comment', `${userName} yorum ekledi.`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Comment error:', error);
    res.status(500).json({ error: 'Yorum eklenemedi' });
  }
});

app.get('/workspaces/:id/comments', authenticateToken, wsMemberAccess, async (req, res) => {
  try {
    const { id } = req.params;
    const { task_id, announcement_id } = req.query;
    let query = `
      SELECT c.*, u.name as user_name
      FROM Comments c
      JOIN Users u ON c.user_id = u.id
      WHERE c.workspace_id = $1
    `;
    const params = [id];
    if (task_id) {
      params.push(task_id);
      query += ` AND c.task_id = $${params.length}`;
    }
    if (announcement_id) {
      params.push(announcement_id);
      query += ` AND c.announcement_id = $${params.length}`;
    }
    query += ' ORDER BY c.created_at ASC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Yorumlar alınamadı' });
  }
});

// ----------------------

// GÖREVLERİ GETİR (Gelişmiş Filtreleme Destekli)
app.get('/tasks', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const userRole = req.user.role;
    const { search, status, priority, category } = req.query;

    let queryParams = [];
    let conditions = [];

    // Rol bazlı veri çekme
    if (userRole === 'admin') {
      // Admin her şeyi görebilir (veya kendi görevleri vs., şimdilik admin her şeyi görsün veya sadece kendi)
      // Kullanıcıların hepsini admin panelinden çekecek. Normal /tasks sadece kendi veya atadıklarını getirebilir.
      // Basitlik için, herkes kendi görevlerini ve manager ise assign ettiklerini görebilir.
      conditions.push(`(userid = $1 OR assigned_by = $1)`);
      queryParams.push(userId);
    } else if (userRole === 'manager') {
      conditions.push(`(userid = $1 OR assigned_by = $1)`);
      queryParams.push(userId);
    } else {
      conditions.push(`userid = $1`);
      queryParams.push(userId);
    }

    // Filtreler
    conditions.push('workspace_id IS NULL');

    if (status) {
      queryParams.push(status);
      conditions.push(`status = $${queryParams.length}`);
    }
    if (priority) {
      queryParams.push(priority);
      conditions.push(`priority = $${queryParams.length}`);
    }
    if (category) {
      queryParams.push(category);
      conditions.push(`category = $${queryParams.length}`);
    }
    if (search) {
      queryParams.push(`%${search}%`);
      conditions.push(`(title ILIKE $${queryParams.length} OR description ILIKE $${queryParams.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT id, title, description, due_date AS duedate, status, category, priority, userid, assigned_by, reminder_date
       FROM Tasks ${whereClause} ORDER BY id DESC`,
      queryParams
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Görev getirme hatası:', error.message);
    res.status(500).json({ error: 'Görevler alınamadı' });
  }
});

// GÖREV EKLE
app.post('/tasks', authenticateToken, async (req, res) => {
  log.info('── GÖREV EKLEME BAŞLADI ──');
  try {
    // Frontend 'duedate' veya 'due_date' gönderebilir, ikisini de destekle
    const { title, description, duedate, due_date, status, category, priority, assign_to, reminder_date } = req.body;
    const actualDueDate = duedate || due_date || null;
    
    // Eğer assign_to varsa ve manager/admin ise başkasına atayabilir
    let targetUserId = req.user.userId;
    let assignedBy = null;
    
    if (assign_to && (req.user.role === 'admin' || req.user.role === 'manager')) {
      targetUserId = assign_to;
      assignedBy = req.user.userId;
    }

    log.info(`Kullanıcı ID: ${targetUserId} (Atayan: ${assignedBy || 'Kendisi'})`);
    log.info(`Başlık: "${title}"  |  Tarih: ${actualDueDate}  |  Durum: ${status}`);

    if (!title || !title.trim()) {
      log.warn('Başlık boş gönderildi!');
      return res.status(400).json({ error: 'Görev başlığı zorunludur.' });
    }

    const sql = `INSERT INTO Tasks (title, description, due_date, status, category, priority, userid, assigned_by, reminder_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, title, description, due_date AS duedate, status, category, priority, userid, assigned_by, reminder_date`;
    const params = [title.trim(), description, actualDueDate, status || 'Bekliyor', category || 'General', priority || 'Medium', targetUserId, assignedBy, reminder_date || null];
    
    log.sql(sql.replace(/\s+/g, ' '));
    log.sql(`Params: ${JSON.stringify(params)}`);

    const result = await pool.query(sql, params);
    
    // Eğer başkasına atandıysa bildirim gönder
    if (assignedBy) {
      await pool.query(
        "INSERT INTO Notifications (user_id, task_id, message, type) VALUES ($1, $2, $3, 'assignment')",
        [targetUserId, result.rows[0].id, `Size yeni bir görev atandı: ${title}`]
      );
    }
    
    log.ok(`Görev eklendi! ID: ${result.rows[0].id}`);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    log.error('GÖREV EKLENEMEDI!');
    log.error(`Mesaj   : ${error.message}`);
    res.status(500).json({ error: error.message || 'Görev eklenemedi', detail: error.detail });
  }
});

// GÖREV GÜNCELLE
app.put('/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    // Frontend 'duedate' veya 'due_date' gönderebilir, ikisini de destekle
    const { title, description, duedate, due_date, status, category, priority, reminder_date } = req.body;
    const actualDueDate = duedate || due_date || null;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Sadece kendi görevi veya admin ise güncelleyebilir veya kendi atadığı görevse (basitlik için check)
    // Şimdilik admin ve managerların hepsini güncellemesine izin verebiliriz veya standart userId kontrolü
    let updateQuery = `UPDATE Tasks SET title = $1, description = $2, due_date = $3, status = $4, category = $5, priority = $6, reminder_date = $7 WHERE id = $8 AND (userid = $9 OR assigned_by = $9 OR $10 = 'admin') RETURNING *`;
    let params = [title, description, actualDueDate, status, category, priority, reminder_date || null, id, userId, userRole];

    const result = await pool.query(updateQuery, params);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Görev bulunamadı veya yetkiniz yok' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Görev güncelleme PostgreSQL hatası:', error);
    res.status(500).json({ error: error.message || 'Görev güncellenemedi' });
  }
});

// GÖREV SİL
app.delete('/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    const result = await pool.query(
      "DELETE FROM Tasks WHERE id = $1 AND (userid = $2 OR assigned_by = $2 OR $3 = 'admin') RETURNING *",
      [id, userId, userRole]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Görev bulunamadı veya yetkiniz yok' });
    }

    res.json({ message: 'Görev silindi ✅' });
  } catch (error) {
    console.error('Görev silme hatası:', error.message);
    res.status(500).json({ error: 'Görev silinemedi' });
  }
});

// DOSYA YÜKLEME (GÖREVE)
app.post('/tasks/:id/upload', authenticateToken, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ error: 'Dosya yüklenemedi' });
    }
    
    // Yetki kontrolü (sadece göreve erişimi olan yükleyebilir)
    const taskCheck = await pool.query(
      "SELECT id FROM Tasks WHERE id = $1 AND (userid = $2 OR assigned_by = $2 OR $3 = 'admin')",
      [id, req.user.userId, req.user.role]
    );
    
    if (taskCheck.rowCount === 0) {
      return res.status(403).json({ error: 'Bu göreve dosya yükleme yetkiniz yok.' });
    }

    const { originalname, filename, mimetype } = req.file;
    const filePath = `/uploads/${filename}`;

    // Frontend encodeURIComponent ile encode ederek gönderiyor
    let finalFileName = req.body.originalFileName || originalname;
    try {
      finalFileName = decodeURIComponent(finalFileName);
    } catch(e) {}

    const result = await pool.query(
      "INSERT INTO Files (task_id, file_name, file_path, file_type) VALUES ($1, $2, $3, $4) RETURNING *",
      [id, finalFileName, filePath, mimetype]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Dosya yükleme hatası:', error);
    res.status(500).json({ error: 'Dosya yüklenemedi' });
  }
});

// GÖREV DOSYALARINI GETİR
app.get('/tasks/:id/files', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    // Yetki kontrolü yap
    const taskCheck = await pool.query(
      "SELECT id FROM Tasks WHERE id = $1 AND (userid = $2 OR assigned_by = $2 OR $3 = 'admin')",
      [id, req.user.userId, req.user.role]
    );
    
    if (taskCheck.rowCount === 0) {
      return res.status(403).json({ error: 'Bu görevin dosyalarını görüntüleme yetkiniz yok.' });
    }

    const result = await pool.query("SELECT * FROM Files WHERE task_id = $1 ORDER BY uploaded_at DESC", [id]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Dosyalar getirilemedi' });
  }
});

// DOSYA SİL
app.delete('/files/:fileId', authenticateToken, async (req, res) => {
  try {
    const { fileId } = req.params;
    // Dosya yolu ve task_id bul
    const fileRes = await pool.query("SELECT * FROM Files WHERE id = $1", [fileId]);
    if (fileRes.rowCount === 0) return res.status(404).json({ error: 'Dosya bulunamadı' });
    
    const file = fileRes.rows[0];
    
    // Yetki kontrolü (task'a yetkisi var mı?)
    const taskCheck = await pool.query(
      "SELECT id FROM Tasks WHERE id = $1 AND (userid = $2 OR assigned_by = $2 OR $3 = 'admin')",
      [file.task_id, req.user.userId, req.user.role]
    );
    if (taskCheck.rowCount === 0) return res.status(403).json({ error: 'Yetkiniz yok' });

    // Dosyayı sistemden sil
    const absolutePath = path.join(__dirname, 'uploads', path.basename(file.file_path));
    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
    
    // DB'den sil
    await pool.query("DELETE FROM Files WHERE id = $1", [fileId]);
    res.json({ message: 'Dosya başarıyla silindi' });
  } catch (error) {
    res.status(500).json({ error: 'Dosya silinemedi' });
  }
});

// BİLDİRİMLERİ GETİR
app.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.*, w.title as workspace_name
      FROM Notifications n
      LEFT JOIN Workspaces w ON n.workspace_id = w.id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC LIMIT 50
    `, [req.user.userId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Bildirimler alınamadı' });
  }
});

// BİLDİRİMİ OKUNDU İŞARETLE
app.put('/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE Notifications SET is_read = true WHERE id = $1 AND user_id = $2", [id, req.user.userId]);
    res.json({ message: 'Okundu işaretlendi' });
  } catch (error) {
    res.status(500).json({ error: 'İşlem başarısız' });
  }
});

// TÜM BİLDİRİMLERİ OKUNDU İŞARETLE
app.put('/notifications/read-all', authenticateToken, async (req, res) => {
  try {
    await pool.query("UPDATE Notifications SET is_read = true WHERE user_id = $1 AND is_read = false", [req.user.userId]);
    res.json({ message: 'Tümü okundu işaretlendi' });
  } catch (error) {
    res.status(500).json({ error: 'İşlem başarısız' });
  }
});

// ADMIN - TÜM KULLANICILARI GETİR
app.get('/admin/users', authenticateToken, authorizeRoles('admin', 'manager'), async (req, res) => {
  try {
    const result = await pool.query("SELECT Id, Name, Email, Role FROM Users ORDER BY Id ASC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: 'Kullanıcılar alınamadı' });
  }
});

// ADMIN - ROL GÜNCELLE
app.put('/admin/users/:id/role', authenticateToken, authorizeRoles('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!['admin', 'manager', 'user'].includes(role)) {
      return res.status(400).json({ error: 'Geçersiz rol' });
    }
    await pool.query("UPDATE Users SET Role = $1 WHERE Id = $2", [role, id]);
    res.json({ message: 'Rol güncellendi' });
  } catch (error) {
    res.status(500).json({ error: 'Rol güncellenemedi' });
  }
});

// BİLDİRİM VE HATIRLATICI CRON JOB'U (Her saat başı çalışır)
cron.schedule('0 * * * *', async () => {
  try {
    log.info('🕒 Gecikmiş görev ve hatırlatıcı kontrolü yapılıyor...');
    const now = new Date();
    
    // Gecikmiş görevler için bildirim ekle
    const overdueRes = await pool.query(`
      SELECT id, title, userid FROM Tasks 
      WHERE due_date < CURRENT_DATE AND status != 'Tamamlandı'
    `);
    
    for (const task of overdueRes.rows) {
      // Sadece 1 kez overdue bildirimi oluştur
      const existingNotif = await pool.query(`
        SELECT id FROM Notifications WHERE user_id = $1 AND task_id = $2 AND type = 'overdue'
      `, [task.userid, task.id]);
      
      if (existingNotif.rowCount === 0) {
        await pool.query(
          "INSERT INTO Notifications (user_id, task_id, message, type) VALUES ($1, $2, $3, 'overdue')",
          [task.userid, task.id, `Gecikmiş görev: "${task.title}" bitiş tarihi geçti!`]
        );
      }
    }
    
    // Yaklaşan hatırlatıcılar için (şu an ile 1 saat sonrası arası reminder_date olanlar)
    const reminderRes = await pool.query(`
      SELECT id, title, userid FROM Tasks 
      WHERE reminder_date >= NOW() AND reminder_date <= NOW() + INTERVAL '1 hour' AND status != 'Tamamlandı'
    `);
    
    for (const task of reminderRes.rows) {
      const existingNotif = await pool.query(`
        SELECT id FROM Notifications WHERE user_id = $1 AND task_id = $2 AND type = 'reminder'
      `, [task.userid, task.id]);
      
      if (existingNotif.rowCount === 0) {
        await pool.query(
          "INSERT INTO Notifications (user_id, task_id, message, type) VALUES ($1, $2, $3, 'reminder')",
          [task.userid, task.id, `Hatırlatıcı: "${task.title}" için zaman yaklaşıyor.`]
        );
      }
    }
  } catch (err) {
    console.error('Cron job hatası:', err);
  }
});

// SERVER BAŞLAT
const PORT = process.env.PORT || 5000;

// DEMO SEED DATA
async function seedDemoData() {
  try {
    // Check if demo data already exists
    const check = await pool.query("SELECT id FROM Users WHERE email = 'owner@demo.com'");
    if (check.rowCount > 0) {
      log.info('Demo verisi zaten mevcut, atlanıyor.');
      return;
    }

    log.info('🌱 Demo verisi oluşturuluyor...');
    const hashedPass = await bcrypt.hash('demo123', 10);

    // Create 3 demo users
    const u1 = await pool.query(
      "INSERT INTO Users (name, email, password, role) VALUES ('Demo Öğretmen', 'owner@demo.com', $1, 'user') RETURNING id",
      [hashedPass]
    );
    const u2 = await pool.query(
      "INSERT INTO Users (name, email, password, role) VALUES ('Demo Öğrenci 1', 'member1@demo.com', $1, 'user') RETURNING id",
      [hashedPass]
    );
    const u3 = await pool.query(
      "INSERT INTO Users (name, email, password, role) VALUES ('Demo Öğrenci 2', 'member2@demo.com', $1, 'user') RETURNING id",
      [hashedPass]
    );

    const ownerId = u1.rows[0].id;
    const member1Id = u2.rows[0].id;
    const member2Id = u3.rows[0].id;

    // Create a workspace
    const inviteCode = 'DEMO01';
    const ws = await pool.query(
      "INSERT INTO Workspaces (title, description, banner_color, invite_code, created_by) VALUES ('Yazılım Geliştirme 101', 'Demo sınıf - Bitirme projesi sunumu için', '#3b82f6', $1, $2) RETURNING id",
      [inviteCode, ownerId]
    );
    const wsId = ws.rows[0].id;

    // Add members
    await pool.query("INSERT INTO WorkspaceMembers (workspace_id, user_id, role) VALUES ($1, $2, 'owner')", [wsId, ownerId]);
    await pool.query("INSERT INTO WorkspaceMembers (workspace_id, user_id, role) VALUES ($1, $2, 'member')", [wsId, member1Id]);
    await pool.query("INSERT INTO WorkspaceMembers (workspace_id, user_id, role) VALUES ($1, $2, 'member')", [wsId, member2Id]);

    // Create a demo announcement
    await pool.query(
      "INSERT INTO WorkspaceAnnouncements (workspace_id, content, title, created_by) VALUES ($1, 'Hoş geldiniz! Bu sınıfta yazılım geliştirme konularını işleyeceğiz.', 'Hoş Geldiniz', $2)",
      [wsId, ownerId]
    );

    // Create a demo task assigned to all members
    const taskRes = await pool.query(
      "INSERT INTO Tasks (title, description, status, userid, workspace_id, assigned_by) VALUES ('İlk Ödev: Proje Planı', 'Proje planınızı hazırlayın ve teslim edin.', 'Bekliyor', $1, $2, $1) RETURNING id",
      [ownerId, wsId]
    );
    await pool.query("INSERT INTO TaskAssignments (task_id, user_id) VALUES ($1, $2)", [taskRes.rows[0].id, member1Id]);
    await pool.query("INSERT INTO TaskAssignments (task_id, user_id) VALUES ($1, $2)", [taskRes.rows[0].id, member2Id]);

    log.ok('🌱 Demo verisi oluşturuldu!');
    log.ok('  Owner:   owner@demo.com / demo123');
    log.ok('  Member1: member1@demo.com / demo123');
    log.ok('  Member2: member2@demo.com / demo123');
    log.ok(`  Davet Kodu: ${inviteCode}`);
  } catch (err) {
    log.error('Demo verisi oluşturulamadı: ' + err.message);
  }
}

app.listen(PORT, async () => {
  console.log(`🌐 Server ${PORT} portunda çalışıyor`);
  await createTables();
  await seedDemoData();

  try {
    await pool.query('SELECT NOW()');
    console.log('✅ PostgreSQL bağlantısı başarılı!');
  } catch (err) {
    console.error('❌ PostgreSQL bağlantı hatası:', err.message);
  }
});