const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const db = require('./database');

const app = express();
const PORT = 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

app.use(session({
  secret: 'chave-super-secreta',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 60000 * 60 * 24 } // 1 dia
}));

// ===== ROTAS DE AUTENTICAÇÃO =====

// Cadastro
app.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Preencha todos os campos' });
  }

  // Verifica se o email já existe
  const userExists = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (userExists) {
    return res.status(400).json({ error: 'Email já cadastrado' });
  }

  // Hash da senha
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    await db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hashedPassword]);
    res.json({ success: true, message: 'Usuário criado com sucesso!' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar usuário' });
  }
});

// Login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Preencha todos os campos' });
  }

  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user) {
    return res.status(400).json({ error: 'Usuário não encontrado' });
  }

  if (user.banned === 1) {
    return res.status(403).json({ error: 'Usuário banido' });
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    return res.status(400).json({ error: 'Senha incorreta' });
  }

  req.session.user = { id: user.id, email: user.email, isSuper: user.isSuper === 1 };
  res.json({ success: true, message: 'Login bem-sucedido' });
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// ===== ROTAS DE POSTAGENS =====

// Criar postagem
app.post('/posts', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Não autenticado' });

  const { content } = req.body;
  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'Conteúdo vazio' });
  }

  try {
    await db.run(
      'INSERT INTO posts (user_id, content) VALUES (?, ?)',
      [req.session.user.id, content]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar post' });
  }
});

// Listar postagens (com dados do autor)
app.get('/posts', async (req, res) => {
  try {
    const posts = await db.all(`
      SELECT posts.*, users.email, users.isSuper 
      FROM posts 
      JOIN users ON posts.user_id = users.id 
      ORDER BY posts.created_at DESC
    `);
    res.json(posts);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar posts' });
  }
});

// Deletar postagem (apenas super ou dono)
app.delete('/posts/:id', async (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Não autenticado' });

  const postId = req.params.id;
  const user = req.session.user;

  // Verificar se o post existe
  const post = await db.get('SELECT user_id FROM posts WHERE id = ?', [postId]);
  if (!post) return res.status(404).json({ error: 'Post não encontrado' });

  // Permissão: super ou dono do post
  if (user.isSuper || post.user_id === user.id) {
    await db.run('DELETE FROM posts WHERE id = ?', [postId]);
    res.json({ success: true });
  } else {
    res.status(403).json({ error: 'Sem permissão' });
  }
});

// ===== ROTAS DE ADMIN (SUPER) =====

// Listar usuários (para super)
app.get('/users', async (req, res) => {
  if (!req.session.user || !req.session.user.isSuper) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  try {
    const users = await db.all('SELECT id, email, banned, isSuper FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar usuários' });
  }
});

// Banir usuário (apenas super)
app.put('/users/:id/ban', async (req, res) => {
  if (!req.session.user || !req.session.user.isSuper) {
    return res.status(403).json({ error: 'Acesso negado' });
  }

  const userId = req.params.id;
  // Não pode banir a si mesmo
  if (parseInt(userId) === req.session.user.id) {
    return res.status(400).json({ error: 'Não pode banir a si mesmo' });
  }

  try {
    await db.run('UPDATE users SET banned = 1 WHERE id = ?', [userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao banir usuário' });
  }
});

// Desbanir usuário
app.put('/users/:id/unban', async (req, res) => {
  if (!req.session.user || !req.session.user.isSuper) {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  try {
    await db.run('UPDATE users SET banned = 0 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao desbanir' });
  }
});

// ===== INICIALIZAÇÃO DO BANCO E SUPER USUÁRIO =====

async function initDatabase() {
  // Criar tabelas
  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      banned INTEGER DEFAULT 0,
      isSuper INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Inserir super usuário se não existir
  const superEmail = 'pedro.gabriel.araujo@escola.com.br';
  const existingSuper = await db.get('SELECT id FROM users WHERE email = ?', [superEmail]);
  if (!existingSuper) {
    const hashed = await bcrypt.hash('123456', 10); // senha padrão (mude depois)
    await db.run(
      'INSERT INTO users (email, password, isSuper) VALUES (?, ?, 1)',
      [superEmail, hashed]
    );
    console.log(`✅ Super usuário criado: ${superEmail} (senha: 123456)`);
  } else {
    console.log(`ℹ️ Super usuário já existe: ${superEmail}`);
  }
}

initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
  });
});