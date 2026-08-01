/* AI Reader · Demo 交互脚本
   主题切换 / 界面切换 / 面板页签 / 模拟流式回复 / Token 色板生成 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ai-reader-demo-theme';

  /* ---------- 主题切换 ---------- */
  var themeToggle = document.getElementById('themeToggle');
  var themeIcon = document.getElementById('themeIcon');
  var themeLabel = document.getElementById('themeLabel');

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    var isGold = theme === 'black-gold';
    themeIcon.textContent = isGold ? 'light_mode' : 'dark_mode';
    themeLabel.textContent = isGold ? '切换白色' : '切换黑金';
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
      /* 演示页持久化失败可忽略 */
    }
  }

  function initTheme() {
    var stored = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      stored = null;
    }
    applyTheme(stored === 'white' || stored === 'black-gold' ? stored : 'black-gold');
  }

  themeToggle.addEventListener('click', function () {
    applyTheme(document.documentElement.dataset.theme === 'black-gold' ? 'white' : 'black-gold');
  });

  /* ---------- 界面切换 ---------- */
  var demoTabs = document.querySelectorAll('.demo-tabs button');

  demoTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      demoTabs.forEach(function (candidate) {
        candidate.classList.toggle('active', candidate === tab);
        candidate.setAttribute('aria-selected', candidate === tab ? 'true' : 'false');
      });
      document.querySelectorAll('.screen').forEach(function (screen) {
        screen.classList.toggle('active', screen.id === 'screen-' + tab.dataset.screen);
      });
      if (tab.dataset.screen === 'reader') {
        window.requestAnimationFrame(positionSelToolbar);
      }
    });
  });

  /* ---------- 工作台右侧面板页签 ---------- */
  var panelTabs = document.querySelectorAll('.panel-tabs button');

  panelTabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      panelTabs.forEach(function (candidate) {
        candidate.classList.toggle('active', candidate === tab);
        candidate.setAttribute('aria-selected', candidate === tab ? 'true' : 'false');
      });
      document.querySelectorAll('.panel-pane').forEach(function (pane) {
        pane.classList.toggle('active', pane.id === 'pane-' + tab.dataset.pane);
      });
    });
  });

  /* ---------- 模拟流式回复 ---------- */
  var promptInput = document.getElementById('promptInput');
  var sendBtn = document.getElementById('sendBtn');
  var conversationInner = document.getElementById('conversationInner');
  var streaming = false;

  function createUserMessage(text) {
    var row = document.createElement('div');
    row.className = 'msg-row user';
    var bubble = document.createElement('div');
    bubble.className = 'msg-user';
    bubble.textContent = text;
    row.appendChild(bubble);
    return row;
  }

  function createAssistantMessage() {
    var row = document.createElement('div');
    row.className = 'msg-row';
    row.innerHTML =
      '<div class="msg-assistant">' +
      '<div class="msg-meta">' +
      '<span class="avatar"><span class="material-symbols-rounded">smart_toy</span></span>' +
      '<strong>AI 分析助手</strong><span>演示模式</span>' +
      '</div>' +
      '<div class="md"><div class="typing"><i></i><i></i><i></i></div><p hidden></p></div>' +
      '</div>';
    return row;
  }

  function streamReply(question) {
    var reply =
      '这是演示模式的模拟回复：已收到你的问题「' +
      question +
      '」。在真实应用中，这里会结合选中的代码片段、当前会话上下文流式输出分析结果，并支持停止、重试与追问。';
    var row = createAssistantMessage();
    conversationInner.appendChild(row);
    row.scrollIntoView({ block: 'end', behavior: 'smooth' });

    var typing = row.querySelector('.typing');
    var target = row.querySelector('p');
    var index = 0;

    window.setTimeout(function () {
      typing.hidden = true;
      target.hidden = false;
      var timer = window.setInterval(function () {
        index += 2;
        target.textContent = reply.slice(0, index);
        if (index >= reply.length) {
          window.clearInterval(timer);
          streaming = false;
        }
      }, 24);
    }, 700);
  }

  function handleSend() {
    var text = promptInput.value.trim();
    if (!text || streaming) return;
    streaming = true;
    conversationInner.appendChild(createUserMessage(text));
    promptInput.value = '';
    streamReply(text);
  }

  sendBtn.addEventListener('click', handleSend);
  promptInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  });

  /* ---------- 阅读器：划词工具条定位 ---------- */
  function positionSelToolbar() {
    var toolbar = document.getElementById('selToolbar');
    var mark = document.querySelector('#screen-reader .article mark');
    var center = document.querySelector('.rd-center');
    if (!toolbar || !mark || !center) return;
    var markRect = mark.getBoundingClientRect();
    var centerRect = center.getBoundingClientRect();
    var top = markRect.top - centerRect.top + center.scrollTop - toolbar.offsetHeight - 10;
    var left =
      markRect.left - centerRect.left + markRect.width / 2 - toolbar.offsetWidth / 2;
    toolbar.style.top = Math.max(8, top) + 'px';
    toolbar.style.left = Math.max(8, left) + 'px';
  }

  window.addEventListener('resize', positionSelToolbar);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(positionSelToolbar);
  }

  /* ---------- Tokens 对照页：色板生成 ---------- */
  var TOKEN_GROUPS = [
    {
      title: '表面层级 SURFACE',
      tokens: ['--surface', '--surface-1', '--surface-2', '--surface-3', '--surface-4'],
    },
    { title: '文字 TEXT', tokens: ['--on-surface', '--on-surface-variant'] },
    {
      title: '品牌与强调 ACCENT',
      tokens: [
        '--primary',
        '--on-primary',
        '--primary-container',
        '--on-primary-container',
        '--accent-strong',
        '--accent-soft',
        '--title-accent',
      ],
    },
    {
      title: '边框 OUTLINE',
      tokens: ['--outline', '--outline-variant', '--panel-border', '--accent-border'],
    },
    {
      title: '语义 SEMANTIC',
      tokens: [
        '--user-bubble-bg',
        '--user-bubble-text',
        '--user-bubble-border',
        '--mark-bg',
        '--mark-text',
        '--error',
        '--success',
        '--warning',
      ],
    },
  ];

  function buildSwatch(panel, name) {
    var card = document.createElement('div');
    card.className = 'sw';
    var color = document.createElement('div');
    color.className = 'sw-color';
    color.style.background = 'var(' + name + ')';
    var info = document.createElement('div');
    info.className = 'sw-info';
    var label = document.createElement('div');
    label.className = 'sw-name';
    label.textContent = name;
    var value = document.createElement('div');
    value.className = 'sw-value';
    value.textContent = window.getComputedStyle(panel).getPropertyValue(name).trim();
    info.appendChild(label);
    info.appendChild(value);
    card.appendChild(color);
    card.appendChild(info);
    return card;
  }

  function buildTypeSample() {
    var sample = document.createElement('div');
    sample.className = 'tk-type-sample';
    sample.innerHTML =
      '<div class="serif">AI Reader · 沉浸式阅读</div>' +
      '<div class="sans">正文使用无衬线字体保证屏显清晰度，标题使用衬线字体建立书卷气。' +
      'The quick brown fox jumps over the lazy dog. 0123456789</div>';
    return sample;
  }

  function buildButtonRow() {
    var row = document.createElement('div');
    row.className = 'tk-btn-row';
    row.innerHTML =
      '<button class="pill-btn"><span class="material-symbols-rounded">add</span>主要操作</button>' +
      '<button class="tonal-btn"><span class="material-symbols-rounded">download</span>次要操作</button>' +
      '<button class="ghost-btn"><span class="material-symbols-rounded">ios_share</span>边框按钮</button>' +
      '<span class="chip">标签</span>' +
      '<button class="icon-btn" aria-label="示例图标按钮"><span class="material-symbols-rounded">settings</span></button>';
    return row;
  }

  function buildTokenPanel(panelId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    TOKEN_GROUPS.forEach(function (group) {
      var section = document.createElement('div');
      var title = document.createElement('div');
      title.className = 'tk-group-title';
      title.textContent = group.title;
      var grid = document.createElement('div');
      grid.className = 'sw-grid';
      group.tokens.forEach(function (name) {
        grid.appendChild(buildSwatch(panel, name));
      });
      section.appendChild(title);
      section.appendChild(grid);
      panel.appendChild(section);
    });

    var typeTitle = document.createElement('div');
    typeTitle.className = 'tk-group-title';
    typeTitle.textContent = '字体与组件 TYPE & CONTROLS';
    panel.appendChild(typeTitle);
    panel.appendChild(buildTypeSample());
    panel.appendChild(buildButtonRow());
  }

  buildTokenPanel('tkWhite');
  buildTokenPanel('tkGold');

  /* ---------- 初始化 ---------- */
  initTheme();
  positionSelToolbar();
})();
