// ===== ELEMENTOS =====
const authContainer = document.getElementById('auth-container');
const timelineContainer = document.getElementById('timeline-container');
const userEmailSpan = document.getElementById('user-email');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginMsg = document.getElementById('login-message');
const registerMsg = document.getElementById('register-message');

const postContent = document.getElementById('post-content');
const postBtn = document.getElementById('post-btn');
const postMsg = document.getElementById('post-message');
const postsList = document.getElementById('posts-list');

const logoutBtn = document.getElementById('logout-btn');

// Tabs
const tabBtns = document.querySelectorAll('.tab-btn');
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    if (tab === 'login') {
      document.getElementById('login-form').classList.add('active');
    } else {
      document.getElementById('register-form').classList.add('active');
    }
    // Limpar mensagens
    loginMsg.textContent = '';
    registerMsg.textContent = '';
  });
});

// ===== FUNÇÕES AUXILIARES =====
function showMessage(el, text, type = 'error') {
  el.textContent = text;
  el.className = 'message ' + type;
}

function getSession() {
  // Não temos acesso direto à sessão no front, usamos o estado após login
  return fetch('/api/session') // rota não criada, mas usamos variável global
    .then(r => r.json()).catch(() => null);
}

// ===== CADASTRO =====
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('register-email').value.trim();
  const password = document.getElementById('register-password').value;

  if (!email || !password) {
    showMessage(registerMsg, 'Preencha todos os campos', 'error');
    return;
  }

  try {
    const res = await fetch('/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      showMessage(registerMsg, data.message, 'success');
      registerForm.reset();
      // Mudar para login
      document.querySelector('[data-tab="login"]').click();
    } else {
      showMessage(registerMsg, data.error, 'error');
    }
  } catch (err) {
    showMessage(registerMsg, 'Erro de conexão', 'error');
  }
});

// ===== LOGIN =====
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  if (!email || !password) {
    showMessage(loginMsg, 'Preencha todos os campos', 'error');
    return;
  }

  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      showMessage(loginMsg, 'Login bem-sucedido!', 'success');
      // Carregar timeline
      authContainer.style.display = 'none';
      timelineContainer.style.display = 'block';
      userEmailSpan.textContent = email;
      await loadPosts();
      // Obtém informações do usuário para saber se é super
      await loadUserInfo();
    } else {
      showMessage(loginMsg, data.error, 'error');
    }
  } catch (err) {
    showMessage(loginMsg, 'Erro de conexão', 'error');
  }
});

// ===== LOGOUT =====
logoutBtn.addEventListener('click', async () => {
  await fetch('/logout', { method: 'POST' });
  authContainer.style.display = 'block';
  timelineContainer.style.display = 'none';
  postsList.innerHTML = '';
  loginForm.reset();
  registerForm.reset();
  loginMsg.textContent = '';
});

// ===== CARREGAR POSTAGENS =====
async function loadPosts() {
  try {
    const res = await fetch('/posts');
    const posts = await res.json();
    if (!Array.isArray(posts)) throw new Error('Dados inválidos');
    renderPosts(posts);
  } catch (err) {
    console.error('Erro ao carregar posts:', err);
  }
}

function renderPosts(posts) {
  postsList.innerHTML = '';
  if (posts.length === 0) {
    postsList.innerHTML = '<p style="text-align:center;color:#65676b;">Nenhuma postagem ainda. Seja o primeiro!</p>';
    return;
  }

  // Obter dados do usuário logado (global)
  let currentUser = null;
  // Tentamos buscar do localStorage ou de uma variável
  // Para simplificar, usamos uma variável global que será setada no login
  // Vamos usar um objeto global "appState"
  if (window.appState && window.appState.user) {
    currentUser = window.appState.user;
  }

  posts.forEach(post => {
    const div = document.createElement('div');
    div.className = 'post';
    div.dataset.postId = post.id;

    const isOwner = currentUser && currentUser.id === post.user_id;
    const isSuper = currentUser && currentUser.isSuper;

    div.innerHTML = `
      <div class="post-header">
        <span class="post-author">${post.email} ${post.isSuper ? '⭐' : ''}</span>
        <span class="post-date">${new Date(post.created_at).toLocaleString()}</span>
      </div>
      <div class="post-content">${escapeHtml(post.content)}</div>
      <div class="post-actions">
        ${(isOwner || isSuper) ? `<button class="delete-btn" data-id="${post.id}">🗑️ Apagar</button>` : ''}
        ${(isSuper && !post.isSuper && post.user_id !== currentUser.id) ? `<button class="ban-btn" data-user-id="${post.user_id}">🚫 Banir autor</button>` : ''}
      </div>
    `;
    postsList.appendChild(div);
  });

  // Adicionar eventos aos botões
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      await deletePost(id);
    });
  });

  document.querySelectorAll('.ban-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const userId = e.target.dataset.userId;
      if (confirm('Banir este usuário?')) {
        await banUser(userId);
      }
    });
  });
}

// Função para escapar HTML (evitar XSS)
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ===== CRIAR POSTAGEM =====
postBtn.addEventListener('click', async () => {
  const content = postContent.value.trim();
  if (!content) {
    showMessage(postMsg, 'Digite algo para publicar', 'error');
    return;
  }

  try {
    const res = await fetch('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    const data = await res.json();
    if (res.ok) {
      postContent.value = '';
      showMessage(postMsg, 'Post publicado!', 'success');
      await loadPosts();
    } else {
      showMessage(postMsg, data.error, 'error');
    }
  } catch (err) {
    showMessage(postMsg, 'Erro ao publicar', 'error');
  }
});

// ===== DELETAR POSTAGEM =====
async function deletePost(postId) {
  if (!confirm('Apagar esta postagem?')) return;
  try {
    const res = await fetch(`/posts/${postId}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      await loadPosts();
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert('Erro ao apagar postagem');
  }
}

// ===== BANIR USUÁRIO =====
async function banUser(userId) {
  try {
    const res = await fetch(`/users/${userId}/ban`, { method: 'PUT' });
    const data = await res.json();
    if (res.ok) {
      alert('Usuário banido com sucesso!');
      await loadPosts(); // recarrega para atualizar botões
    } else {
      alert(data.error);
    }
  } catch (err) {
    alert('Erro ao banir usuário');
  }
}

// ===== CARREGAR INFORMAÇÕES DO USUÁRIO LOGADO =====
async function loadUserInfo() {
  try {
    const res = await fetch('/api/me'); // vamos criar essa rota no server
    if (res.ok) {
      const user = await res.json();
      window.appState = window.appState || {};
      window.appState.user = user;
    }
  } catch (e) {
    // fallback: tentar pegar do session storage
  }
}

// ===== INICIALIZAÇÃO =====
// Verificar se já está logado (por sessão) ao carregar a página
async function checkSession() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const user = await res.json();
      window.appState = { user };
      authContainer.style.display = 'none';
      timelineContainer.style.display = 'block';
      userEmailSpan.textContent = user.email;
      await loadPosts();
    }
  } catch (e) {
    // Não logado
  }
}
checkSession();