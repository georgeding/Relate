// Relate Hub — settings UI. Plain JS SPA, no build step. Talks only to /hub/api/* (see docs/PLATFORM.md).
'use strict';
(() => {
  const API = '/hub/api';
  const KEEP = '__set__';            // secret placeholder: "a value is stored, keep it"

  // ---------------------------------------------------------------- i18n
  const I18N = {
    en: {
      'app.name': 'Relate Hub', 'nav.spaces': 'Spaces', 'nav.settings': 'Settings', 'nav.logout': 'Log out', 'lang.toggle': '中文',
      'auth.setup.title': 'Welcome to Relate Hub', 'auth.setup.sub': 'Set a password to protect this hub. You will use it to sign in from any browser.',
      'auth.password': 'Password', 'auth.confirm': 'Confirm password', 'auth.setup.btn': 'Set password & continue',
      'auth.login.title': 'Sign in', 'auth.login.sub': 'Enter the hub password.', 'auth.login.btn': 'Sign in',
      'auth.short': 'Use at least 8 characters.', 'auth.mismatch': 'Passwords do not match.',
      'home.title': 'Spaces', 'home.sub': 'Each space is one assistant with its own sources, memory and dashboard.', 'home.new': 'New space',
      'home.empty.title': 'Create your first space', 'home.empty.body': 'A space connects your chats (WeChat, Telegram, any app that can post messages) to an AI assistant that keeps a living memory, todos and a dashboard.',
      'home.empty.cta': 'Create a space',
      'status.running': 'Running', 'status.stopped': 'Stopped', 'status.starting': 'Starting', 'status.crashed': 'Crashed',
      'space.open': 'Open dashboard', 'space.start': 'Start', 'space.stop': 'Stop', 'space.restart': 'Restart', 'space.settings': 'Settings',
      'space.port': 'Port {port}', 'space.chats': '{n} chats', 'space.chat1': '1 chat', 'space.allChats': 'all chats', 'space.noConnectors': 'No connectors yet',
      'act.started': 'Started {name}', 'act.stopped': 'Stopped {name}', 'act.restarted': 'Restarted {name}',
      'wiz.title': 'New space', 'wiz.s1': 'Template', 'wiz.s2': 'Sources', 'wiz.s3': 'Review',
      'wiz.pickTpl': 'What is this space for?', 'wiz.name': 'Space name', 'wiz.name.ph': 'e.g. Family, My shop, Project X',
      'wiz.me': 'Your name', 'wiz.me.help': 'How the assistant refers to you.',
      'wiz.next': 'Next', 'wiz.back': 'Back', 'wiz.cancel': 'Cancel', 'wiz.create': 'Create space', 'wiz.creating': 'Creating…',
      'wiz.conns': 'Connectors', 'wiz.conns.help': 'Where messages come from. You can add more later.',
      'wiz.addConn': 'Add connector', 'wiz.pickType': 'Connector type',
      'wiz.chats': 'Chats to follow', 'wiz.chats.help': 'Leave empty to accept every chat from the connectors above.',
      'wiz.partner': 'Partner', 'wiz.partner.help': 'Relationship spaces focus on one person — pick the chat that is them.',
      'wiz.partner.need': 'Pick which chat is your partner.',
      'wiz.review': 'Review', 'wiz.done.title': 'Space created', 'wiz.done.body': '{name} is ready. Start it now to begin syncing.',
      'wiz.startNow': 'Start now', 'wiz.goSettings': 'Open settings', 'wiz.goHome': 'Back to spaces',
      'conn.id': 'Connector ID', 'conn.id.help': 'Short unique name used to reference this connector.', 'conn.enabled': 'Enabled',
      'conn.test': 'Test connection', 'conn.testing': 'Testing…', 'conn.ok': 'Connected', 'conn.pick': 'Pick chats', 'conn.loading': 'Loading chats…',
      'conn.remove': 'Remove', 'conn.noList': 'This connector cannot list chats. Add chat IDs manually below.',
      'conn.addSel': 'Add selected', 'conn.selAll': 'Select all', 'conn.filter': 'Filter chats', 'conn.added': 'Added {n} chats',
      'cap.live': 'live', 'cap.history': 'history', 'cap.send': 'can send', 'cap.episodes': 'recordings',
      'chat.connector': 'Connector', 'chat.id': 'Chat ID', 'chat.name': 'Name', 'chat.kind': 'Kind', 'chat.add': 'Add',
      'chat.dm': 'Direct', 'chat.group': 'Group', 'chat.none': 'No chats — every chat is accepted.', 'chat.remove': 'Remove',
      'secret.set': 'Stored', 'secret.replace': 'Replace', 'secret.cancel': 'Keep current', 'secret.new': 'Enter a new value',
      'list.help': 'One per line.',
      'tab.general': 'General', 'tab.connectors': 'Connectors', 'tab.chats': 'Chats', 'tab.ai': 'AI', 'tab.access': 'Access', 'tab.logs': 'Logs', 'tab.danger': 'Danger zone',
      'save': 'Save changes', 'saving': 'Saving…', 'saved': 'Saved', 'unsaved': 'Unsaved changes', 'discard': 'Discard',
      'restart.needed': 'Restart needed for changes to take effect.', 'restart.now': 'Restart now',
      'gen.template': 'Template', 'gen.template.help': 'Changing the template changes how the assistant thinks; restart required.',
      'gen.target': 'Partner chat', 'gen.target.none': '— none —',
      'ai.useGlobal': 'Use the global AI settings', 'ai.useGlobal.help': 'Recommended. Override only if this space needs a different provider or model.',
      'ai.base': 'API base URL', 'ai.key': 'API key', 'ai.model': 'Model', 'ai.enabled': 'AI enabled', 'ai.maxCalls': 'Max calls per hour',
      'ai.pause': 'Pause AI when nobody has the dashboard open', 'ai.test': 'Test AI', 'ai.testOk': 'OK in {ms} ms',
      'acc.dash': 'Dashboard password', 'acc.authEnabled': 'Require a password to open this space dashboard',
      'acc.ingest': 'Ingest token', 'acc.ingest.help': 'Any app or bridge can push messages into this space with this token.',
      'acc.ingest.none': 'No token yet — generate one to enable the ingest API.',
      'acc.regen': 'Regenerate', 'acc.gen': 'Generate token', 'acc.copy': 'Copy', 'acc.copied': 'Copied', 'acc.saveToApply': 'Save to apply the new token.',
      'acc.example': 'Example', 'acc.docs': 'Body can be one message, {"messages":[…]} or {"episodes":[…]}. Ingest connectors you add yourself use /api/ingest/<connector id> with their own token.',
      'logs.auto': 'Auto-refresh', 'logs.tail': 'Lines', 'logs.empty': 'No log output yet.', 'logs.refresh': 'Refresh',
      'danger.delete': 'Delete this space', 'danger.delete.help': 'Stops the space and removes it from the hub.',
      'danger.purge': 'Also delete all of its data (messages, memory, todos). This cannot be undone.',
      'danger.confirm': 'Type {id} to confirm', 'danger.btn': 'Delete space', 'danger.deleted': 'Deleted {name}',
      'gs.title': 'Settings', 'gs.sub': 'Defaults shared by every space.', 'gs.ai': 'AI provider', 'gs.ai.help': 'Any OpenAI-compatible endpoint (JSON mode required).',
      'gs.workers': 'Space workers', 'gs.sandbox': 'Sandbox space workers (Node permission model: file access limited to the space folder)',
      'gs.router': 'Recording router', 'gs.router.help': 'Recordings (e.g. Plaud) dropped in the inbox are classified and sent to the right spaces.',
      'gs.router.enabled': 'Route recordings automatically', 'gs.router.inbox': 'Inbox folder', 'gs.router.min': 'Minimum confidence (0–1)',
      'gs.router.min.help': 'Below this, a recording waits in the review queue instead of being routed.',
      'rv.title': 'Review queue', 'rv.empty': 'Nothing waiting for review.', 'rv.route': 'Route', 'rv.routed': 'Routed', 'rv.pick': 'Pick at least one space.',
      'rv.suggested': 'suggested {score}',
      'err.load': 'Could not load', 'err.unauthorized': 'Signed out', 'err.network': 'Network error — is the hub running?',
      'loading': 'Loading…', 'yes': 'Yes', 'no': 'No', 'back': 'Back',
      'tab.plugins': 'Plugins',
      'pl.intro': 'Plugins add tools, background jobs and extra knowledge to this space.',
      'pl.createAi': 'Create with AI', 'pl.newBlank': 'New blank plugin',
      'pl.codeWarning': 'Plugins are code that runs inside this space with access to its chats. Saving never enables a plugin — read the code first, then enable it.',
      'pl.sandboxOn': 'Sandbox is on: space workers can only read and write their own folder.',
      'pl.sandboxOff': 'Sandbox is off, so plugins run with this computer’s full file access. Turn it on before enabling plugins you did not write:', 'pl.sandboxLink': 'Global settings → Sandbox',
      'pl.describe': 'Describe what it should do', 'pl.describe.ph': 'e.g. Every morning, list anyone who asked me a question yesterday that I have not answered.',
      'pl.describe.help': 'Plain language is fine. Mention when it should run and whether it may send messages (those always need your approval).',
      'pl.describe.need': 'Describe what the plugin should do.',
      'pl.nameOptional': 'Name (optional)', 'pl.name': 'Plugin name', 'pl.name.help': 'Lowercase letters, digits and dashes; must match the name inside the code.',
      'pl.badName': 'Use 2–40 lowercase letters, digits or dashes, starting with a letter.',
      'pl.description': 'Description', 'pl.blankDesc': 'My plugin', 'pl.startEditing': 'Open editor',
      'pl.draft': 'Write draft', 'pl.drafting': 'Writing the plugin…', 'pl.draftingHint': 'usually 20–60 seconds',
      'pl.draftCode': 'Draft code — review before saving', 'pl.code': 'Code', 'pl.code.help': 'Tab inserts two spaces. The code is checked in a sandbox when you save.',
      'pl.provides': 'What it adds', 'pl.providesNothing': 'Nothing detected yet.',
      'pl.tool': 'tool', 'pl.needsApproval': 'needs approval', 'pl.tick1': '1 background job', 'pl.ticks': '{n} background jobs',
      'pl.context': 'adds context to answers', 'pl.routes': '{n} HTTP routes', 'pl.connector': 'connector', 'pl.template': 'template', 'pl.setup': 'runs at start-up',
      'pl.problems': 'Problems found', 'pl.hasProblems': 'problems', 'pl.noLoad': 'The file did not load, so its contents are unknown.',
      'pl.save': 'Save', 'pl.saveCopy': 'Save as this space’s copy', 'pl.regenerate': 'Regenerate', 'pl.discard': 'Discard', 'pl.close': 'Close',
      'pl.saveNote': 'Saved plugins stay off until you enable them in the list below.',
      'pl.notSaved': 'Not saved — the file does not load.', 'pl.saved': 'Saved {name}',
      'pl.settings': 'Settings', 'pl.saveSettings': 'Save settings', 'pl.viewCode': 'View / edit code',
      'pl.sharedEdit': 'This is a shared plugin. Saving creates a copy for this space only, which replaces the shared version here.',
      'pl.delete': 'Delete', 'pl.deleteConfirm': 'Click again to delete', 'pl.deleted': 'Deleted {name}',
      'pl.enabled': 'Enabled {name}', 'pl.disabled': 'Disabled {name}',
      'pl.shared': 'shared', 'pl.spaceScope': 'this space', 'pl.builtin': 'built-in',
      'pl.empty.title': 'No plugins yet', 'pl.empty.body': 'Create one with AI by describing what you want, or start from a blank template.',
    },
    zh: {
      'app.name': 'Relate 中枢', 'nav.spaces': '空间', 'nav.settings': '设置', 'nav.logout': '退出登录', 'lang.toggle': 'EN',
      'auth.setup.title': '欢迎使用 Relate 中枢', 'auth.setup.sub': '先设置一个密码来保护中枢，之后在任何浏览器都用它登录。',
      'auth.password': '密码', 'auth.confirm': '确认密码', 'auth.setup.btn': '设置密码并继续',
      'auth.login.title': '登录', 'auth.login.sub': '输入中枢密码。', 'auth.login.btn': '登录',
      'auth.short': '至少 8 个字符。', 'auth.mismatch': '两次密码不一致。',
      'home.title': '空间', 'home.sub': '每个空间是一个独立的助理：自己的数据源、记忆和看板。', 'home.new': '新建空间',
      'home.empty.title': '创建你的第一个空间', 'home.empty.body': '空间把你的聊天（微信、Telegram，或任何能推送消息的应用）接到一个 AI 助理上，它会维护实时记忆、待办和看板。',
      'home.empty.cta': '创建空间',
      'status.running': '运行中', 'status.stopped': '已停止', 'status.starting': '启动中', 'status.crashed': '已崩溃',
      'space.open': '打开看板', 'space.start': '启动', 'space.stop': '停止', 'space.restart': '重启', 'space.settings': '设置',
      'space.port': '端口 {port}', 'space.chats': '{n} 个聊天', 'space.chat1': '1 个聊天', 'space.allChats': '全部聊天', 'space.noConnectors': '还没有连接器',
      'act.started': '已启动 {name}', 'act.stopped': '已停止 {name}', 'act.restarted': '已重启 {name}',
      'wiz.title': '新建空间', 'wiz.s1': '模板', 'wiz.s2': '数据源', 'wiz.s3': '确认',
      'wiz.pickTpl': '这个空间用来做什么？', 'wiz.name': '空间名称', 'wiz.name.ph': '例如：家人、我的店、某项目',
      'wiz.me': '你的名字', 'wiz.me.help': '助理如何称呼你。',
      'wiz.next': '下一步', 'wiz.back': '上一步', 'wiz.cancel': '取消', 'wiz.create': '创建空间', 'wiz.creating': '创建中…',
      'wiz.conns': '连接器', 'wiz.conns.help': '消息从哪里来。之后可以再添加。',
      'wiz.addConn': '添加连接器', 'wiz.pickType': '连接器类型',
      'wiz.chats': '要跟进的聊天', 'wiz.chats.help': '留空则接收上述连接器的所有聊天。',
      'wiz.partner': '对象', 'wiz.partner.help': '关系空间聚焦一个人——选出代表对方的那个聊天。',
      'wiz.partner.need': '请选择哪个聊天是你的对象。',
      'wiz.review': '确认', 'wiz.done.title': '空间已创建', 'wiz.done.body': '{name} 已就绪，现在启动即可开始同步。',
      'wiz.startNow': '立即启动', 'wiz.goSettings': '打开设置', 'wiz.goHome': '返回空间列表',
      'conn.id': '连接器 ID', 'conn.id.help': '用于引用这个连接器的简短唯一名称。', 'conn.enabled': '启用',
      'conn.test': '测试连接', 'conn.testing': '测试中…', 'conn.ok': '已连接', 'conn.pick': '选择聊天', 'conn.loading': '正在加载聊天…',
      'conn.remove': '移除', 'conn.noList': '该连接器无法列出聊天，请在下方手动添加聊天 ID。',
      'conn.addSel': '添加所选', 'conn.selAll': '全选', 'conn.filter': '筛选聊天', 'conn.added': '已添加 {n} 个聊天',
      'cap.live': '实时', 'cap.history': '历史', 'cap.send': '可发送', 'cap.episodes': '录音',
      'chat.connector': '连接器', 'chat.id': '聊天 ID', 'chat.name': '名称', 'chat.kind': '类型', 'chat.add': '添加',
      'chat.dm': '私聊', 'chat.group': '群聊', 'chat.none': '没有限定——接收所有聊天。', 'chat.remove': '移除',
      'secret.set': '已保存', 'secret.replace': '替换', 'secret.cancel': '保留现有', 'secret.new': '输入新值',
      'list.help': '每行一个。',
      'tab.general': '常规', 'tab.connectors': '连接器', 'tab.chats': '聊天', 'tab.ai': 'AI', 'tab.access': '访问', 'tab.logs': '日志', 'tab.danger': '危险操作',
      'save': '保存更改', 'saving': '保存中…', 'saved': '已保存', 'unsaved': '有未保存的更改', 'discard': '放弃',
      'restart.needed': '需要重启才能生效。', 'restart.now': '立即重启',
      'gen.template': '模板', 'gen.template.help': '更换模板会改变助理的思考方式；需要重启。',
      'gen.target': '对象聊天', 'gen.target.none': '— 无 —',
      'ai.useGlobal': '使用全局 AI 设置', 'ai.useGlobal.help': '推荐。只有这个空间需要不同的服务商或模型时才覆盖。',
      'ai.base': 'API 地址', 'ai.key': 'API 密钥', 'ai.model': '模型', 'ai.enabled': '启用 AI', 'ai.maxCalls': '每小时最多调用次数',
      'ai.pause': '没人打开看板时暂停 AI', 'ai.test': '测试 AI', 'ai.testOk': '成功，{ms} 毫秒',
      'acc.dash': '看板密码', 'acc.authEnabled': '打开此空间看板需要密码',
      'acc.ingest': '推送令牌', 'acc.ingest.help': '任何应用或桥接程序都可以用这个令牌把消息推送进这个空间。',
      'acc.ingest.none': '还没有令牌——生成一个以启用推送接口。',
      'acc.regen': '重新生成', 'acc.gen': '生成令牌', 'acc.copy': '复制', 'acc.copied': '已复制', 'acc.saveToApply': '保存后新令牌生效。',
      'acc.example': '示例', 'acc.docs': '请求体可以是一条消息、{"messages":[…]} 或 {"episodes":[…]}。你自己添加的推送连接器使用 /api/ingest/<连接器 ID> 和它自己的令牌。',
      'logs.auto': '自动刷新', 'logs.tail': '行数', 'logs.empty': '暂无日志。', 'logs.refresh': '刷新',
      'danger.delete': '删除这个空间', 'danger.delete.help': '停止该空间并从中枢移除。',
      'danger.purge': '同时删除它的全部数据（消息、记忆、待办）。无法撤销。',
      'danger.confirm': '输入 {id} 以确认', 'danger.btn': '删除空间', 'danger.deleted': '已删除 {name}',
      'gs.title': '设置', 'gs.sub': '所有空间共享的默认设置。', 'gs.ai': 'AI 服务商', 'gs.ai.help': '任何兼容 OpenAI 的接口（需要支持 JSON 模式）。',
      'gs.workers': '空间进程', 'gs.sandbox': '沙箱运行空间进程（Node 权限模型：文件访问仅限该空间文件夹）',
      'gs.router': '录音分发', 'gs.router.help': '放进收件箱的录音（如 Plaud）会被分类并发送到对应的空间。',
      'gs.router.enabled': '自动分发录音', 'gs.router.inbox': '收件箱文件夹', 'gs.router.min': '最低置信度（0–1）',
      'gs.router.min.help': '低于该值的录音会进入待审核队列，而不是自动分发。',
      'rv.title': '待审核', 'rv.empty': '没有待审核的录音。', 'rv.route': '分发', 'rv.routed': '已分发', 'rv.pick': '至少选择一个空间。',
      'rv.suggested': '建议 {score}',
      'err.load': '加载失败', 'err.unauthorized': '已退出登录', 'err.network': '网络错误——中枢在运行吗？',
      'loading': '加载中…', 'yes': '是', 'no': '否', 'back': '返回',
      'tab.plugins': '插件',
      'pl.intro': '插件可以为这个空间添加工具、后台任务和额外知识。',
      'pl.createAi': '用 AI 创建', 'pl.newBlank': '新建空白插件',
      'pl.codeWarning': '插件是在这个空间里运行的代码，可以访问它的聊天记录。保存不会启用插件——请先阅读代码，再启用。',
      'pl.sandboxOn': '沙箱已开启：空间进程只能读写自己的文件夹。',
      'pl.sandboxOff': '沙箱未开启，插件拥有这台电脑的完整文件访问权限。启用不是你自己写的插件前，请先开启：', 'pl.sandboxLink': '全局设置 → 沙箱',
      'pl.describe': '描述它要做什么', 'pl.describe.ph': '例如：每天早上列出昨天问了我问题、但我还没回复的人。',
      'pl.describe.help': '用大白话就行。说明它什么时候运行、能不能发消息（发消息总是需要你批准）。',
      'pl.describe.need': '请描述插件要做什么。',
      'pl.nameOptional': '名称（可选）', 'pl.name': '插件名称', 'pl.name.help': '小写字母、数字和短横线；必须和代码里的 name 一致。',
      'pl.badName': '请用 2–40 个小写字母、数字或短横线，并以字母开头。',
      'pl.description': '描述', 'pl.blankDesc': '我的插件', 'pl.startEditing': '打开编辑器',
      'pl.draft': '生成草稿', 'pl.drafting': '正在编写插件…', 'pl.draftingHint': '通常需要 20–60 秒',
      'pl.draftCode': '草稿代码——保存前请检查', 'pl.code': '代码', 'pl.code.help': 'Tab 键插入两个空格。保存时会在沙箱里检查代码。',
      'pl.provides': '它会添加', 'pl.providesNothing': '暂未检测到任何内容。',
      'pl.tool': '工具', 'pl.needsApproval': '需要批准', 'pl.tick1': '1 个后台任务', 'pl.ticks': '{n} 个后台任务',
      'pl.context': '为回答补充背景', 'pl.routes': '{n} 个 HTTP 接口', 'pl.connector': '连接器', 'pl.template': '模板', 'pl.setup': '启动时运行',
      'pl.problems': '发现的问题', 'pl.hasProblems': '有问题', 'pl.noLoad': '文件无法加载，因此不知道它的内容。',
      'pl.save': '保存', 'pl.saveCopy': '保存为本空间的副本', 'pl.regenerate': '重新生成', 'pl.discard': '放弃', 'pl.close': '关闭',
      'pl.saveNote': '保存后的插件默认关闭，需要在下方列表中启用。',
      'pl.notSaved': '未保存——文件无法加载。', 'pl.saved': '已保存 {name}',
      'pl.settings': '设置', 'pl.saveSettings': '保存设置', 'pl.viewCode': '查看 / 编辑代码',
      'pl.sharedEdit': '这是共享插件。保存会为本空间创建一个副本，并在这里替代共享版本。',
      'pl.delete': '删除', 'pl.deleteConfirm': '再点一次确认删除', 'pl.deleted': '已删除 {name}',
      'pl.enabled': '已启用 {name}', 'pl.disabled': '已停用 {name}',
      'pl.shared': '共享', 'pl.spaceScope': '本空间', 'pl.builtin': '内置',
      'pl.empty.title': '还没有插件', 'pl.empty.body': '描述你想要的功能让 AI 来写，或者从空白模板开始。',
    },
  };
  let lang = 'en';
  try { const saved = localStorage.getItem('hub.lang'); if (saved === 'en' || saved === 'zh') lang = saved; else if (/^zh/i.test(navigator.language || '')) lang = 'zh'; } catch { /* storage blocked */ }
  function t(key, vars) {
    let s = (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
    return s;
  }
  function setLang(l) { lang = l; try { localStorage.setItem('hub.lang', l); } catch { /* ignore */ } document.documentElement.lang = l === 'zh' ? 'zh-CN' : 'en'; route(); }
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';

  // ---------------------------------------------------------------- dom helpers
  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'indeterminate']);
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (PROPS.has(k)) e[k] = v;
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    const add = (c) => { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(add); else e.append(c instanceof Node ? c : document.createTextNode(String(c))); };
    kids.forEach(add);
    return e;
  }
  let uid = 0;
  const nextId = (p) => `${p || 'f'}-${++uid}`;
  function toast(msg, kind) {
    const box = document.getElementById('toasts');
    const n = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, msg);
    box.append(n); setTimeout(() => n.remove(), kind === 'err' ? 6000 : 3000);
  }
  const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
  const fmtTime = (ts) => { if (!ts) return ''; const d = new Date(ts); return isNaN(d) ? String(ts) : d.toLocaleString(lang === 'zh' ? 'zh-CN' : undefined); };
  function busy(btn, label) { const old = [...btn.childNodes]; btn.disabled = true; btn.replaceChildren(h('span', { class: 'spinner', 'aria-hidden': 'true' }), ' ', label); return () => { btn.disabled = false; btn.replaceChildren(...old); }; }
  function randomToken(bytes = 24) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  async function copyText(text) { try { await navigator.clipboard.writeText(text); toast(t('acc.copied'), 'ok'); } catch { toast(text); } }

  // ---------------------------------------------------------------- api
  const state = { authed: false, setupNeeded: false, meta: null, spaces: [] };
  async function api(method, path, body) {
    let r;
    try {
      r = await fetch(API + path, { method, credentials: 'same-origin', headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch { throw new Error(t('err.network')); }
    const txt = await r.text();
    let data = null; try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }
    if (r.status === 401 && !/^\/(session|login|setup|logout)\b/.test(path)) { state.authed = false; toast(t('err.unauthorized'), 'err'); boot(); throw new Error(t('err.unauthorized')); }
    if (!r.ok) {
      const msg = (data && (data.error || (Array.isArray(data.errors) && data.errors.join('; ')))) || `HTTP ${r.status}`;
      const e = new Error(msg); e.status = r.status; e.data = data; throw e;
    }
    return data;
  }
  const tplLabel = (id) => (state.meta?.templates || []).find((x) => x.id === id)?.label || id || '?';
  const ctype = (type) => (state.meta?.connectorTypes || []).find((x) => x.type === type);

  // ---------------------------------------------------------------- timers (cleared on every route)
  let timers = [];
  function every(ms, fn) { const id = setInterval(fn, ms); timers.push(id); return id; }
  function clearTimers() { timers.forEach(clearInterval); timers = []; }

  // ---------------------------------------------------------------- shell
  const app = () => document.getElementById('app');
  function langBtn() { return h('button', { class: 'btn ghost sm', type: 'button', onclick: () => setLang(lang === 'en' ? 'zh' : 'en'), 'aria-label': 'Language' }, t('lang.toggle')); }
  function logoutBtn() {
    return h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
      if (sp && sp.dirty) sp = null;
      try { await api('POST', '/logout'); } catch { /* signed out either way */ }
      state.authed = false; wz = null; sp = null; clearTimers(); location.hash = '#/'; boot();
    } }, t('nav.logout'));
  }
  function shell(active, content) {
    const nav = (href, key, id) => h('a', { href, 'aria-current': active === id ? 'page' : null }, t(key));
    app().replaceChildren(
      h('header', { class: 'topbar' }, h('div', { class: 'topbar-in' },
        h('a', { class: 'brand', href: '#/' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }), t('app.name')),
        h('nav', { class: 'nav', 'aria-label': 'Main' }, nav('#/', 'nav.spaces', 'home'), nav('#/settings', 'nav.settings', 'settings'), langBtn(), logoutBtn()))),
      h('main', { id: 'main' }, content));
  }

  // ---------------------------------------------------------------- auth screens
  function viewSetup() {
    const pid = nextId('pw'), cid = nextId('pw2');
    const err = h('div', { class: 'errline', hidden: true });
    const form = h('form', { onsubmit: async (ev) => {
      ev.preventDefault(); err.hidden = true;
      const pw = form.querySelector('#' + pid).value, pw2 = form.querySelector('#' + cid).value;
      if (pw.length < 8) { err.textContent = t('auth.short'); err.hidden = false; return; }
      if (pw !== pw2) { err.textContent = t('auth.mismatch'); err.hidden = false; return; }
      const done = busy(form.querySelector('button[type=submit]'), t('loading'));
      try { await api('POST', '/setup', { password: pw }); await api('POST', '/login', { password: pw }).catch(() => {}); boot(); }
      catch (e) { err.textContent = e.message; err.hidden = false; done(); }
    } },
      h('div', { class: 'field' }, h('label', { for: pid }, t('auth.password')), h('input', { id: pid, type: 'password', autocomplete: 'new-password', required: true, minlength: 8, autofocus: true })),
      h('div', { class: 'field' }, h('label', { for: cid }, t('auth.confirm')), h('input', { id: cid, type: 'password', autocomplete: 'new-password', required: true })),
      err, h('div', { class: 'btn-row', style: 'margin-top:14px' }, h('button', { class: 'btn primary', type: 'submit' }, t('auth.setup.btn'))));
    app().replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'lang-corner' }, langBtn()),
      h('div', { class: 'card' }, h('h1', {}, t('auth.setup.title')), h('p', { class: 'sub' }, t('auth.setup.sub')), form)));
  }
  function viewLogin() {
    const pid = nextId('pw');
    const err = h('div', { class: 'errline', hidden: true });
    const form = h('form', { onsubmit: async (ev) => {
      ev.preventDefault(); err.hidden = true;
      const done = busy(form.querySelector('button[type=submit]'), t('loading'));
      try { await api('POST', '/login', { password: form.querySelector('#' + pid).value }); boot(); }
      catch (e) { err.textContent = e.message; err.hidden = false; done(); }
    } },
      h('div', { class: 'field' }, h('label', { for: pid }, t('auth.password')), h('input', { id: pid, type: 'password', autocomplete: 'current-password', required: true, autofocus: true })),
      err, h('div', { class: 'btn-row', style: 'margin-top:14px' }, h('button', { class: 'btn primary', type: 'submit' }, t('auth.login.btn'))));
    app().replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'lang-corner' }, langBtn()),
      h('div', { class: 'card' }, h('h1', {}, t('auth.login.title')), h('p', { class: 'sub' }, t('auth.login.sub')), form)));
  }

  // ---------------------------------------------------------------- schema-driven fields
  // Renders one configSchema field bound to obj[f.key]; calls onChange() after every edit.
  function schemaField(f, obj, onChange) {
    const id = nextId(f.key);
    const label = h('label', { for: id }, f.label || f.key, f.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null);
    const help = f.help ? h('div', { class: 'help', id: id + '-h' }, f.help) : null;
    const described = f.help ? id + '-h' : null;
    const set = (v) => { obj[f.key] = v; onChange && onChange(); };
    let v = obj[f.key];
    if (v === undefined && f.default !== undefined) { obj[f.key] = clone(f.default); v = obj[f.key]; }
    let control;
    switch (f.type) {
      case 'bool':
        return h('div', { class: 'field' }, h('label', { class: 'check', for: id },
          h('input', { id, type: 'checkbox', checked: !!v, 'aria-describedby': described, onchange: (e) => set(e.target.checked) }), f.label || f.key), help);
      case 'number':
        control = h('input', { id, type: 'number', value: v ?? '', required: !!f.required, 'aria-describedby': described, oninput: (e) => set(e.target.value === '' ? '' : Number(e.target.value)) });
        break;
      case 'select': {
        const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: String(o) }));
        control = h('select', { id, 'aria-describedby': described, onchange: (e) => set(e.target.value) },
          f.required ? null : h('option', { value: '' }, '—'),
          opts.map((o) => h('option', { value: o.value, selected: String(o.value) === String(v ?? '') }, o.label ?? o.value)));
        break;
      }
      case 'list': {
        const text = Array.isArray(v) ? v.join('\n') : (v || '');
        control = h('textarea', { id, rows: 3, 'aria-describedby': described, oninput: (e) => set(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)) }, text);
        return h('div', { class: 'field' }, label, control, h('div', { class: 'help' }, [f.help, t('list.help')].filter(Boolean).join(' ')));
      }
      case 'secret':
        return secretField(id, label, help, described, v, set, f.required);
      default: // string | url | path
        control = h('input', { id, type: f.type === 'url' ? 'url' : 'text', value: v ?? '', required: !!f.required, spellcheck: 'false', autocomplete: 'off', placeholder: f.placeholder || (f.type === 'url' ? 'https://' : null), 'aria-describedby': described, oninput: (e) => set(e.target.value) });
    }
    return h('div', { class: 'field' }, label, control, help);
  }
  // secret: never render the stored value. "__set__" means stored; Replace swaps in an empty input.
  function secretField(id, label, help, described, value, set, required) {
    const wrap = h('div', { class: 'field' });
    const editor = () => h('input', { id, type: 'password', autocomplete: 'new-password', placeholder: t('secret.new'), required: !!required, 'aria-describedby': described, oninput: (e) => set(e.target.value) });
    function draw(replacing) {
      if (value === KEEP && !replacing) {
        wrap.replaceChildren(...[label, h('div', { class: 'secret-set' }, h('span', { 'aria-hidden': 'true' }, '••••'), t('secret.set'),
          h('button', { class: 'btn sm', type: 'button', style: 'margin-left:auto', onclick: () => { draw(true); wrap.querySelector('input')?.focus(); } }, t('secret.replace'))), help].filter(Boolean));
      } else if (value === KEEP && replacing) {
        wrap.replaceChildren(...[label, h('div', { class: 'token' }, editor(), h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { set(KEEP); draw(false); } }, t('secret.cancel'))), help].filter(Boolean));
      } else {
        const inp = editor(); inp.value = value || ''; wrap.replaceChildren(...[label, inp, help].filter(Boolean));
      }
    }
    draw(false);
    return wrap;
  }

  function capBadges(caps) {
    if (!caps) return null;
    return ['live', 'history', 'send', 'episodes'].filter((k) => caps[k]).map((k) => h('span', { class: 'badge' + (k === 'send' ? ' accent' : '') }, t('cap.' + k)));
  }
  function uniqueConnId(type, existing) {
    const base = String(type || 'conn').replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'conn';
    let id = base, n = 2; while (existing.some((c) => c.id === id)) id = `${base}-${n++}`; return id;
  }
  function newConnector(type, existing) {
    const ct = ctype(type); const c = { id: uniqueConnId(type, existing), type, enabled: true };
    for (const f of ct?.configSchema || []) if (f.default !== undefined) c[f.key] = clone(f.default);
    return c;
  }

  // Connector editor card. opts: { space?, onChange, onRemove, onPickChats(chats[]), liveStatus }
  // `space` (settings pages only) lets the hub resolve masked "__set__" secrets from the stored config.
  function connectorEditor(conn, opts) {
    const ct = ctype(conn.type);
    const result = h('div', { 'aria-live': 'polite' });
    const picker = h('div');
    const statusChip = opts.liveStatus ? h('span', { class: 'status' }, h('span', { class: 'dot ' + (opts.liveStatus.state || '') }), opts.liveStatus.state || '') : null;
    const idId = nextId('cid');
    const reqBody = () => (opts.space ? { type: conn.type, config: conn, space: opts.space } : { type: conn.type, config: conn });
    const testBtn = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      const done = busy(testBtn, t('conn.testing')); result.replaceChildren();
      try {
        const r = await api('POST', '/connectors/test', reqBody());
        result.replaceChildren(r && r.ok ? h('div', { class: 'okline' }, '✓ ', t('conn.ok'), r.info ? ' — ' + r.info : '') : h('div', { class: 'errline' }, (r && r.error) || 'Failed'));
      } catch (e) { result.replaceChildren(h('div', { class: 'errline' }, e.message)); }
      done();
    } }, t('conn.test'));
    const pickBtn = opts.onPickChats ? h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      const done = busy(pickBtn, t('conn.loading')); picker.replaceChildren();
      try {
        const list = await api('POST', '/connectors/chats', reqBody());
        if (!Array.isArray(list) || !list.length) picker.replaceChildren(h('p', { class: 'muted small', style: 'margin-top:10px' }, t('conn.noList')));
        else picker.replaceChildren(chatPicker(list, (sel) => { opts.onPickChats(sel.map((c) => ({ connector: conn.id, chatId: c.chatId, name: c.name || c.chatId, kind: c.kind === 'group' ? 'group' : 'dm' }))); picker.replaceChildren(); }));
      } catch (e) { picker.replaceChildren(h('div', { class: 'errline', style: 'margin-top:10px' }, e.message)); }
      done();
    } }, t('conn.pick')) : null;
    const body = h('div', { class: 'conn-body' },
      h('div', { class: 'field' }, h('label', { for: idId }, t('conn.id')),
        h('input', { id: idId, type: 'text', value: conn.id, spellcheck: 'false', 'aria-describedby': idId + '-h', oninput: (e) => { const old = conn.id; conn.id = e.target.value.trim(); opts.onRename && opts.onRename(old, conn.id); opts.onChange && opts.onChange(); } }),
        h('div', { class: 'help', id: idId + '-h' }, t('conn.id.help'))),
      (ct?.configSchema || []).map((f) => schemaField(f, conn, opts.onChange)),
      h('div', { class: 'conn-tools' }, testBtn, pickBtn),
      result, picker);
    return h('section', { class: 'conn', 'aria-label': ct?.label || conn.type },
      h('div', { class: 'conn-head' },
        h('span', { class: 'title' }, ct?.label || conn.type), h('span', { class: 'badge' }, conn.type), capBadges(ct?.capabilities), statusChip,
        h('span', { class: 'grow' }),
        h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: conn.enabled !== false, onchange: (e) => { conn.enabled = e.target.checked; opts.onChange && opts.onChange(); } }), t('conn.enabled')),
        opts.onRemove ? h('button', { class: 'btn sm danger', type: 'button', onclick: opts.onRemove }, t('conn.remove')) : null),
      body);
  }

  function chatPicker(list, onAdd) {
    const filterId = nextId('flt');
    const boxes = list.map((c) => ({ c, input: h('input', { type: 'checkbox' }) }));
    const rows = h('div', { class: 'picker', role: 'group', 'aria-label': t('conn.pick') },
      boxes.map(({ c, input }) => h('label', { 'data-q': `${c.name || ''} ${c.chatId}`.toLowerCase() }, input,
        h('span', {}, c.name || c.chatId, h('div', { class: 'muted small mono' }, c.chatId)),
        h('span', { class: 'badge kind' }, t(c.kind === 'group' ? 'chat.group' : 'chat.dm')))));
    const filter = h('input', { id: filterId, type: 'text', placeholder: t('conn.filter'), 'aria-label': t('conn.filter'), oninput: (e) => {
      const q = e.target.value.toLowerCase(); rows.querySelectorAll('label').forEach((l) => { l.hidden = q && !l.dataset.q.includes(q); });
    } });
    return h('div', { style: 'margin-top:12px' }, list.length > 8 ? filter : null, rows,
      h('div', { class: 'picker-foot' },
        h('button', { class: 'btn sm', type: 'button', onclick: () => boxes.forEach(({ input }) => { if (!input.closest('label').hidden) input.checked = true; }) }, t('conn.selAll')),
        h('button', { class: 'btn sm primary', type: 'button', onclick: () => { const sel = boxes.filter((b) => b.input.checked).map((b) => b.c); if (sel.length) { onAdd(sel); toast(t('conn.added', { n: sel.length }), 'ok'); } } }, t('conn.addSel'))));
  }

  // Chat allowlist editor. chats = array (mutated). opts: { connectors, onChange, partner: {get,set} | null }
  function chatsEditor(chats, opts) {
    const wrap = h('div');
    function draw() {
      const rows = chats.map((c, i) => h('tr', {},
        opts.partner ? h('td', {}, h('input', { type: 'radio', name: 'partner', 'aria-label': t('wiz.partner') + ': ' + (c.name || c.chatId), checked: opts.partner.get() === i, onchange: () => { opts.partner.set(i); opts.onChange && opts.onChange(); } })) : null,
        h('td', {}, c.name || '—'), h('td', { class: 'mono' }, c.chatId), h('td', {}, h('span', { class: 'badge' }, c.connector)),
        h('td', {}, t(c.kind === 'group' ? 'chat.group' : 'chat.dm')),
        h('td', {}, h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': t('chat.remove') + ' ' + (c.name || c.chatId), onclick: () => { chats.splice(i, 1); opts.partner && opts.partner.removed(i); opts.onChange && opts.onChange(); draw(); } }, '✕'))));
      const table = chats.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, opts.partner ? h('th', {}, t('wiz.partner')) : null, h('th', {}, t('chat.name')), h('th', {}, t('chat.id')), h('th', {}, t('chat.connector')), h('th', {}, t('chat.kind')), h('th', {}, h('span', { class: 'sr-only' }, t('chat.remove'))))),
        h('tbody', {}, rows))) : h('p', { class: 'muted small' }, t('chat.none'));
      // manual add row
      const ids = { conn: nextId('mc'), id: nextId('mi'), name: nextId('mn'), kind: nextId('mk') };
      const connIds = (opts.connectors() || []).map((c) => c.id);
      const add = h('div', { class: 'inline', style: 'margin-top:12px' },
        h('div', { class: 'field' }, h('label', { for: ids.conn }, t('chat.connector')), h('select', { id: ids.conn }, connIds.map((id) => h('option', { value: id }, id)))),
        h('div', { class: 'field' }, h('label', { for: ids.id }, t('chat.id')), h('input', { id: ids.id, type: 'text', spellcheck: 'false' })),
        h('div', { class: 'field' }, h('label', { for: ids.name }, t('chat.name')), h('input', { id: ids.name, type: 'text' })),
        h('div', { class: 'field' }, h('label', { for: ids.kind }, t('chat.kind')), h('select', { id: ids.kind }, h('option', { value: 'dm' }, t('chat.dm')), h('option', { value: 'group' }, t('chat.group')))),
        h('button', { class: 'btn', type: 'button', disabled: !connIds.length, onclick: () => {
          const chatId = add.querySelector('#' + ids.id).value.trim(); if (!chatId) { add.querySelector('#' + ids.id).focus(); return; }
          chats.push({ connector: add.querySelector('#' + ids.conn).value, chatId, name: add.querySelector('#' + ids.name).value.trim() || chatId, kind: add.querySelector('#' + ids.kind).value });
          opts.onChange && opts.onChange(); draw();
        } }, t('chat.add')));
      wrap.replaceChildren(table, add);
    }
    wrap.redraw = draw; draw();
    return wrap;
  }
  function addChats(chats, incoming) {
    let n = 0;
    for (const c of incoming) if (!chats.some((x) => x.connector === c.connector && x.chatId === c.chatId)) { chats.push(c); n++; }
    return n;
  }

  // ---------------------------------------------------------------- home
  async function viewHome() {
    const grid = h('div', { class: 'grid', 'aria-busy': 'true' }, h('p', { class: 'muted' }, t('loading')));
    shell('home', [h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, t('home.title')), h('div', { class: 'sub' }, t('home.sub'))),
      h('a', { class: 'btn primary', href: '#/new' }, '+ ', t('home.new'))), grid]);
    const refresh = async () => {
      let spaces;
      try { spaces = await api('GET', '/spaces'); } catch (e) { grid.replaceChildren(h('div', { class: 'errline' }, t('err.load'), ': ', e.message)); return; }
      state.spaces = spaces || [];
      const live = {};
      await Promise.all(state.spaces.filter((s) => s.status === 'running').map(async (s) => { try { live[s.id] = normLive(await api('GET', `/spaces/${enc(s.id)}/live`)); } catch { /* worker busy */ } }));
      grid.removeAttribute('aria-busy');
      if (!state.spaces.length) {
        grid.replaceChildren(h('div', { class: 'empty', style: 'grid-column:1/-1' }, h('h2', {}, t('home.empty.title')), h('p', {}, t('home.empty.body')), h('a', { class: 'btn primary', href: '#/new' }, t('home.empty.cta'))));
        return;
      }
      grid.replaceChildren(...state.spaces.map((s) => spaceCard(s, live[s.id], refresh)));
    };
    await refresh();
    every(5000, refresh);
  }
  const enc = encodeURIComponent;
  function normLive(x) { const arr = Array.isArray(x) ? x : (x && Array.isArray(x.connectors) ? x.connectors : []); const m = {}; for (const c of arr) m[c.id] = c.status || { state: c.state }; return m; }
  function statusDot(status) { return h('span', { class: 'status' }, h('span', { class: 'dot ' + (status || 'stopped'), 'aria-hidden': 'true' }), t('status.' + (status || 'stopped'))); }
  function spaceCard(s, live, refresh) {
    const running = s.status === 'running';
    const act = (verb, key) => async (ev) => {
      const done = busy(ev.currentTarget, t('loading'));
      try { await api('POST', `/spaces/${enc(s.id)}/${verb}`); toast(t(key, { name: s.name }), 'ok'); }
      catch (e) { toast(e.message, 'err'); }
      done(); refresh();
    };
    const chips = (s.connectors || []).map((c) => {
      const st = live && live[c.id];
      return h('span', { class: 'chip' + (c.enabled === false ? ' off' : ''), title: st?.info || c.type },
        running && c.enabled !== false ? h('span', { class: 'dot ' + (st?.state || 'idle'), 'aria-hidden': 'true' }) : null, c.id,
        running && st?.state ? h('span', { class: 'sr-only' }, st.state) : null);
    });
    return h('article', { class: 'card space', 'aria-label': s.name },
      h('div', { class: 'space-top' }, h('a', { class: 'space-name', href: `#/space/${enc(s.id)}/general` }, s.name), h('span', { class: 'badge accent' }, tplLabel(s.template))),
      h('div', { class: 'space-meta' }, statusDot(s.status), s.port ? h('span', {}, t('space.port', { port: s.port })) : null,
        h('span', {}, s.chatCount ? (s.chatCount === 1 ? t('space.chat1') : t('space.chats', { n: s.chatCount })) : t('space.allChats'))),
      s.status === 'crashed' && s.lastError ? h('div', { class: 'errline' }, s.lastError) : null,
      h('div', { class: 'chips' }, chips.length ? chips : h('span', { class: 'muted small' }, t('space.noConnectors'))),
      h('div', { class: 'space-actions' },
        h('a', { class: 'btn sm primary', href: s.url || '#', target: '_blank', rel: 'noopener', 'aria-disabled': running && s.url ? null : 'true', tabindex: running && s.url ? null : '-1' }, t('space.open'), ' ↗'),
        running || s.status === 'starting'
          ? [h('button', { class: 'btn sm', type: 'button', onclick: act('restart', 'act.restarted') }, t('space.restart')), h('button', { class: 'btn sm', type: 'button', onclick: act('stop', 'act.stopped') }, t('space.stop'))]
          : h('button', { class: 'btn sm', type: 'button', onclick: act('start', 'act.started') }, t('space.start')),
        h('a', { class: 'btn sm ghost', href: `#/space/${enc(s.id)}/general`, style: 'margin-left:auto' }, t('space.settings'))));
  }

  // ---------------------------------------------------------------- wizard
  let wz = null;
  function viewWizard() {
    if (!wz) wz = { step: 1, template: null, name: '', me: '', connectors: [], chats: [], partner: -1, created: null };
    const main = h('div');
    shell('home', [h('div', { class: 'crumbs' }, h('a', { href: '#/' }, t('nav.spaces')), ' / ', t('wiz.title')), h('div', { class: 'page-head' }, h('h1', {}, t('wiz.title'))), main]);
    const draw = () => {
      const steps = h('ol', { class: 'steps', 'aria-label': 'Progress' }, [1, 2, 3].map((n) =>
        h('li', { class: n < wz.step ? 'done' : '', 'aria-current': n === wz.step ? 'step' : null }, h('span', { class: 'n' }, n < wz.step ? '✓' : n), t('wiz.s' + n))));
      if (wz.created) return main.replaceChildren(wizDone());
      main.replaceChildren(steps, wz.step === 1 ? wizStep1(draw) : wz.step === 2 ? wizStep2(draw) : wizStep3(draw));
      main.querySelector('h2')?.focus?.();
    };
    draw();
  }
  function wizFoot(back, next) { return h('div', { class: 'wiz-foot' }, back, h('span', { style: 'flex:1' }), next); }
  function wizStep1(draw) {
    const nameId = nextId('nm'), meId = nextId('me');
    const tpls = state.meta?.templates || [];
    const nextBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => { wz.step = 2; draw(); } }, t('wiz.next'), ' →');
    const upd = () => { nextBtn.disabled = !(wz.template && wz.name.trim()); };
    const grid = h('div', { class: 'tpl-grid', role: 'group', 'aria-label': t('wiz.pickTpl') }, tpls.map((tp) =>
      h('button', { class: 'tpl', type: 'button', 'aria-pressed': wz.template === tp.id ? 'true' : 'false', onclick: (e) => {
        wz.template = tp.id; grid.querySelectorAll('.tpl').forEach((b) => b.setAttribute('aria-pressed', 'false')); e.currentTarget.setAttribute('aria-pressed', 'true'); upd();
      } }, h('span', { class: 't' }, tp.label || tp.id), h('span', { class: 'd' }, tp.description || ''))));
    const node = h('div', {},
      h('h2', { tabindex: '-1' }, t('wiz.pickTpl')), grid,
      h('div', { class: 'two' },
        h('div', { class: 'field' }, h('label', { for: nameId }, t('wiz.name'), h('span', { class: 'req', 'aria-hidden': 'true' }, '*')),
          h('input', { id: nameId, type: 'text', value: wz.name, placeholder: t('wiz.name.ph'), required: true, oninput: (e) => { wz.name = e.target.value; upd(); } })),
        h('div', { class: 'field' }, h('label', { for: meId }, t('wiz.me')), h('input', { id: meId, type: 'text', value: wz.me, 'aria-describedby': meId + '-h', oninput: (e) => { wz.me = e.target.value; } }), h('div', { class: 'help', id: meId + '-h' }, t('wiz.me.help')))),
      wizFoot(h('a', { class: 'btn ghost', href: '#/', onclick: () => { wz = null; } }, t('wiz.cancel')), nextBtn));
    upd();
    return node;
  }
  function wizStep2(draw) {
    const typeId = nextId('ty');
    const types = state.meta?.connectorTypes || [];
    const connBox = h('div');
    let chatsBox;
    const isRel = wz.template === 'relationship';
    const partner = isRel ? { get: () => wz.partner, set: (i) => { wz.partner = i; }, removed: (i) => { if (wz.partner === i) wz.partner = -1; else if (wz.partner > i) wz.partner--; } } : null;
    const drawConns = () => connBox.replaceChildren(...wz.connectors.map((c, i) => connectorEditor(c, {
      onChange: () => chatsBox && chatsBox.redraw(),
      onRename: (o, n) => wz.chats.forEach((ch) => { if (ch.connector === o) ch.connector = n; }),
      onRemove: () => { const id = c.id; wz.connectors.splice(i, 1); for (let k = wz.chats.length - 1; k >= 0; k--) if (wz.chats[k].connector === id) { wz.chats.splice(k, 1); partner && partner.removed(k); } drawConns(); chatsBox.redraw(); },
      onPickChats: (list) => { addChats(wz.chats, list); chatsBox.redraw(); },
    })));
    const typeSel = h('select', { id: typeId }, types.map((ct) => h('option', { value: ct.type }, ct.label || ct.type)));
    chatsBox = chatsEditor(wz.chats, { connectors: () => wz.connectors, partner });
    drawConns();
    const err = h('div', { class: 'errline', hidden: true });
    return h('div', {},
      h('h2', { tabindex: '-1' }, t('wiz.conns')), h('p', { class: 'muted' }, t('wiz.conns.help')),
      connBox,
      h('div', { class: 'btn-row', style: 'margin-top:12px' },
        h('label', { for: typeId, class: 'sr-only' }, t('wiz.pickType')), h('div', { style: 'min-width:200px' }, typeSel),
        h('button', { class: 'btn', type: 'button', disabled: !types.length, onclick: () => { wz.connectors.push(newConnector(typeSel.value, wz.connectors)); drawConns(); chatsBox.redraw(); } }, '+ ', t('wiz.addConn'))),
      h('hr', { class: 'divider' }),
      h('h2', {}, t('wiz.chats')), h('p', { class: 'muted' }, isRel ? t('wiz.partner.help') : t('wiz.chats.help')),
      chatsBox, err,
      wizFoot(h('button', { class: 'btn ghost', type: 'button', onclick: () => { wz.step = 1; draw(); } }, '← ', t('wiz.back')),
        h('button', { class: 'btn primary', type: 'button', onclick: () => {
          if (isRel && wz.chats.length && wz.partner < 0) { err.textContent = t('wiz.partner.need'); err.hidden = false; return; }
          wz.step = 3; draw();
        } }, t('wiz.next'), ' →')));
  }
  function wizConfig() {
    const cfg = { name: wz.name.trim(), template: wz.template, connectors: wz.connectors, chats: wz.chats };
    if (wz.me.trim()) cfg.me = { name: wz.me.trim() };
    const p = wz.chats[wz.partner];
    if (wz.template === 'relationship' && p) cfg.target = { name: p.name, chatId: p.chatId, connector: p.connector };
    return cfg;
  }
  function wizStep3(draw) {
    const cfg = wizConfig();
    const err = h('div', { class: 'errline', hidden: true });
    const row = (k, v) => h('tr', {}, h('th', { scope: 'row', style: 'width:34%' }, k), h('td', {}, v));
    const createBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const done = busy(createBtn, t('wiz.creating')); err.hidden = true;
      try {
        const sp = await api('POST', '/spaces', { name: cfg.name, template: cfg.template });
        const id = sp && (sp.id || sp.space?.id);
        const r = await api('PUT', `/spaces/${enc(id)}`, cfg);
        if (r && r.errors && r.errors.length) throw new Error(r.errors.join('; '));
        wz.created = { id, name: cfg.name }; draw();
      } catch (e) { err.textContent = e.message; err.hidden = false; done(); }
    } }, t('wiz.create'));
    return h('div', {},
      h('h2', { tabindex: '-1' }, t('wiz.review')),
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        row(t('wiz.name'), cfg.name), row(t('gen.template'), tplLabel(cfg.template)), cfg.me ? row(t('wiz.me'), cfg.me.name) : null,
        row(t('wiz.conns'), cfg.connectors.length ? cfg.connectors.map((c) => h('span', { class: 'badge', style: 'margin-right:4px' }, `${c.id} · ${c.type}`)) : h('span', { class: 'muted' }, '—')),
        row(t('wiz.chats'), cfg.chats.length ? (cfg.chats.length === 1 ? t('space.chat1') : t('space.chats', { n: cfg.chats.length })) : t('space.allChats')),
        cfg.target ? row(t('wiz.partner'), `${cfg.target.name} (${cfg.target.chatId})`) : null))),
      err,
      wizFoot(h('button', { class: 'btn ghost', type: 'button', onclick: () => { wz.step = 2; draw(); } }, '← ', t('wiz.back')), createBtn));
  }
  function wizDone() {
    const { id, name } = wz.created;
    const startBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const done = busy(startBtn, t('loading'));
      try { await api('POST', `/spaces/${enc(id)}/start`); toast(t('act.started', { name }), 'ok'); wz = null; location.hash = '#/'; }
      catch (e) { toast(e.message, 'err'); done(); }
    } }, t('wiz.startNow'));
    return h('div', { class: 'empty' }, h('h2', { tabindex: '-1' }, '✓ ', t('wiz.done.title')), h('p', {}, t('wiz.done.body', { name })),
      h('div', { class: 'btn-row', style: 'justify-content:center' }, startBtn,
        h('a', { class: 'btn', href: `#/space/${enc(id)}/general`, onclick: () => { wz = null; } }, t('wiz.goSettings')),
        h('a', { class: 'btn ghost', href: '#/', onclick: () => { wz = null; } }, t('wiz.goHome'))));
  }

  // ---------------------------------------------------------------- space settings
  const TABS = ['general', 'connectors', 'chats', 'plugins', 'ai', 'access', 'logs', 'danger'];
  let sp = null;   // { id, cfg (working copy), dirty, restartNeeded, summary }
  async function viewSpace(id, tab) {
    if (!TABS.includes(tab)) tab = 'general';
    if (!sp || sp.id !== id) {
      shell('home', h('p', { class: 'muted' }, t('loading')));
      try {
        const [cfg, spaces] = await Promise.all([api('GET', `/spaces/${enc(id)}`), api('GET', '/spaces').catch(() => [])]);
        sp = { id, cfg: cfg || {}, dirty: false, restartNeeded: false, summary: (spaces || []).find((s) => s.id === id) || null };
      } catch (e) { shell('home', [h('div', { class: 'errline' }, t('err.load'), ': ', e.message), h('p', {}, h('a', { href: '#/' }, '← ', t('back')))]); return; }
    }
    const cfg = sp.cfg;
    cfg.connectors = cfg.connectors || []; cfg.chats = cfg.chats || [];
    const savebar = h('div', { class: 'savebar', hidden: !sp.dirty });
    const markDirty = () => { sp.dirty = true; drawSavebar(); };
    const banner = h('div');
    const drawBanner = () => banner.replaceChildren(sp.restartNeeded ? h('div', { class: 'banner', role: 'status' }, t('restart.needed'),
      h('button', { class: 'btn sm', type: 'button', onclick: async (e) => {
        const done = busy(e.currentTarget, t('loading'));
        try { await api('POST', `/spaces/${enc(id)}/restart`); sp.restartNeeded = false; toast(t('act.restarted', { name: cfg.name || id }), 'ok'); drawBanner(); }
        catch (err) { toast(err.message, 'err'); done(); }
      } }, t('restart.now'))) : '');
    function drawSavebar() {
      savebar.hidden = !sp.dirty || tab === 'logs' || tab === 'danger' || tab === 'plugins';
      const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const done = busy(saveBtn, t('saving'));
        try {
          const r = await api('PUT', `/spaces/${enc(id)}`, cfg);
          if (r && r.errors && r.errors.length) { toast(r.errors.join('; '), 'err'); done(); return; }
          sp.cfg = await api('GET', `/spaces/${enc(id)}`); sp.dirty = false; if (r && r.restartNeeded) sp.restartNeeded = true;
          toast(t('saved'), 'ok'); viewSpace(id, tab);
        } catch (e) { toast(e.message, 'err'); done(); }
      } }, t('save'));
      savebar.replaceChildren(h('span', { class: 'dirty' }, t('unsaved')), h('div', { class: 'btn-row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => { sp = null; viewSpace(id, tab); } }, t('discard')), saveBtn));
    }
    const tabs = h('div', { class: 'tabs', role: 'tablist' }, TABS.map((k) => h('a', { role: 'tab', href: `#/space/${enc(id)}/${k}`, 'aria-selected': k === tab ? 'true' : 'false', class: k === 'danger' ? 'danger-tab' : null }, t('tab.' + k))));
    const panel = h('div', { role: 'tabpanel' });
    const summary = sp.summary;
    shell('home', [
      h('div', { class: 'crumbs' }, h('a', { href: '#/' }, t('nav.spaces')), ' / ', cfg.name || id),
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, cfg.name || id), h('div', { class: 'sub space-meta' }, h('span', { class: 'badge accent' }, tplLabel(cfg.template)), summary ? statusDot(summary.status) : null, summary?.port ? t('space.port', { port: summary.port }) : null)),
        summary?.url && summary.status === 'running' ? h('a', { class: 'btn', href: summary.url, target: '_blank', rel: 'noopener' }, t('space.open'), ' ↗') : null),
      banner, tabs, panel, savebar]);
    drawBanner(); drawSavebar();
    // plugin actions save immediately (not via the savebar); they raise the banner through this
    const needRestart = (flag) => { if (flag || ['running', 'starting'].includes(sp.summary?.status)) { sp.restartNeeded = true; drawBanner(); } };
    const P = { general: tabGeneral, connectors: tabConnectors, chats: tabChats, plugins: tabPlugins, ai: tabAi, access: tabAccess, logs: tabLogs, danger: tabDanger }[tab];
    P(panel, cfg, markDirty, id, needRestart);
  }

  function tabGeneral(panel, cfg, dirty) {
    const nm = nextId('n'), me = nextId('m'), tp = nextId('t'), tg = nextId('g');
    cfg.me = cfg.me || {};
    const isRel = cfg.template === 'relationship';
    const partnerIdx = cfg.target ? cfg.chats.findIndex((c) => c.chatId === cfg.target.chatId && (!cfg.target.connector || c.connector === cfg.target.connector)) : -1;
    panel.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'two' },
        h('div', { class: 'field' }, h('label', { for: nm }, t('wiz.name')), h('input', { id: nm, type: 'text', value: cfg.name || '', oninput: (e) => { cfg.name = e.target.value; dirty(); } })),
        h('div', { class: 'field' }, h('label', { for: me }, t('wiz.me')), h('input', { id: me, type: 'text', value: cfg.me.name || '', 'aria-describedby': me + '-h', oninput: (e) => { cfg.me.name = e.target.value; dirty(); } }), h('div', { class: 'help', id: me + '-h' }, t('wiz.me.help')))),
      h('div', { class: 'field' }, h('label', { for: tp }, t('gen.template')),
        h('select', { id: tp, 'aria-describedby': tp + '-h', onchange: (e) => { cfg.template = e.target.value; dirty(); } }, (state.meta?.templates || []).map((x) => h('option', { value: x.id, selected: x.id === cfg.template }, x.label || x.id))),
        h('div', { class: 'help', id: tp + '-h' }, t('gen.template.help'))),
      isRel ? h('div', { class: 'field' }, h('label', { for: tg }, t('gen.target')),
        h('select', { id: tg, 'aria-describedby': tg + '-h', onchange: (e) => { const c = cfg.chats[Number(e.target.value)]; cfg.target = c ? { name: c.name, chatId: c.chatId, connector: c.connector } : null; dirty(); } },
          h('option', { value: '-1' }, t('gen.target.none')), cfg.chats.map((c, i) => h('option', { value: String(i), selected: i === partnerIdx }, `${c.name || c.chatId} · ${c.connector}`))),
        h('div', { class: 'help', id: tg + '-h' }, t('wiz.partner.help'))) : null));
  }

  async function tabConnectors(panel, cfg, dirty, id) {
    const typeId = nextId('ty');
    const list = h('div');
    let live = {};
    if (sp.summary?.status === 'running') { try { live = normLive(await api('GET', `/spaces/${enc(id)}/live`)); } catch { /* ignore */ } }
    const draw = () => list.replaceChildren(...(cfg.connectors.length ? cfg.connectors.map((c, i) => connectorEditor(c, {
      space: id, onChange: dirty, liveStatus: live[c.id],
      onRename: (o, n) => { cfg.chats.forEach((ch) => { if (ch.connector === o) ch.connector = n; }); if (cfg.target && cfg.target.connector === o) cfg.target.connector = n; },
      onRemove: () => { cfg.connectors.splice(i, 1); dirty(); draw(); },
      onPickChats: (chs) => { const n = addChats(cfg.chats, chs); if (n) dirty(); },
    })) : [h('p', { class: 'muted' }, t('space.noConnectors'))]));
    draw();
    const typeSel = h('select', { id: typeId }, (state.meta?.connectorTypes || []).map((ct) => h('option', { value: ct.type }, ct.label || ct.type)));
    panel.replaceChildren(list, h('div', { class: 'btn-row', style: 'margin-top:14px' },
      h('label', { for: typeId, class: 'sr-only' }, t('wiz.pickType')), h('div', { style: 'min-width:200px' }, typeSel),
      h('button', { class: 'btn', type: 'button', onclick: () => { cfg.connectors.push(newConnector(typeSel.value, cfg.connectors)); dirty(); draw(); } }, '+ ', t('wiz.addConn'))));
  }

  function tabChats(panel, cfg, dirty) {
    panel.replaceChildren(h('div', { class: 'card' }, h('h2', {}, t('wiz.chats')), h('p', { class: 'muted' }, t('wiz.chats.help')),
      chatsEditor(cfg.chats, { connectors: () => cfg.connectors, onChange: dirty, partner: null }),
      cfg.connectors.length ? h('p', { class: 'muted small', style: 'margin-top:12px' }, t('conn.pick'), ': ', h('a', { href: `#/space/${enc(sp.id)}/connectors` }, t('tab.connectors'))) : null));
  }

  // ---------------------------------------------------------------- plugins tab
  const PLUGIN_NAME = /^[a-z][a-z0-9-]{1,39}$/;
  function blankPlugin(name, desc) {
    const tool = name.replace(/-/g, '_') + '_stats';
    return [
      `// ${name} — ${desc}`,
      '// See docs/PLUGINS.md for everything a plugin can do.',
      'export default {',
      `  name: ${JSON.stringify(name)},`,
      `  description: ${JSON.stringify(desc)},`,
      "  version: '0.1.0',",
      '  configSchema: [],',
      '  tools: [{',
      `    name: ${JSON.stringify(tool)},`,
      "    description: 'Count the messages in this space over the last N days',",
      "    parameters: { type: 'object', properties: { days: { type: 'number', description: 'How many days back (default 7)' } } },",
      '    readOnly: true,',
      '    async run(args, api) {',
      '      const days = Number(args.days) || 7;',
      '      const since = Date.now() - days * 86400000;',
      '      const recent = api.messages().filter((m) => m.ts >= since);',
      '      return { days, messages: recent.length, fromMe: recent.filter((m) => m.isSend === 1).length };',
      '    },',
      '  }],',
      '};',
      '',
    ].join('\n');
  }
  function problemsBox(problems) {
    if (!problems || !problems.length) return null;
    return h('div', { class: 'warnbox', role: 'status' }, h('strong', {}, t('pl.problems')), h('ul', {}, problems.map((p) => h('li', {}, p))));
  }
  function providesList(meta) {
    const pv = meta?.provides || {};
    const items = [];
    for (const tl of pv.tools || []) items.push(h('span', { class: 'badge' }, t('pl.tool'), ' ', h('code', {}, tl.name), tl.readOnly === false ? h('span', { class: 'badge warn' }, t('pl.needsApproval')) : null));
    if (pv.ticks) items.push(h('span', { class: 'badge' }, pv.ticks === 1 ? t('pl.tick1') : t('pl.ticks', { n: pv.ticks })));
    if (pv.context) items.push(h('span', { class: 'badge' }, t('pl.context')));
    if ((pv.routes || []).length) items.push(h('span', { class: 'badge', title: pv.routes.join('\n') }, t('pl.routes', { n: pv.routes.length })));
    for (const c of pv.connectors || []) items.push(h('span', { class: 'badge accent' }, t('pl.connector'), ' ', c));
    for (const d of pv.domains || []) items.push(h('span', { class: 'badge accent' }, t('pl.template'), ' ', d));
    if (pv.setup) items.push(h('span', { class: 'badge' }, t('pl.setup')));
    return items.length ? h('div', { class: 'chips' }, items) : h('span', { class: 'muted small' }, t('pl.providesNothing'));
  }
  // code editor used by drafts, blank plugins and "View / Edit"
  function codeEditor(code, labelKey) {
    const id = nextId('code');
    const ta = h('textarea', { id, class: 'code-editor', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'off', wrap: 'off', rows: 22 }, code || '');
    ta.addEventListener('keydown', (e) => {   // Tab inserts two spaces instead of leaving the editor
      if (e.key !== 'Tab' || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
      e.preventDefault(); const s = ta.selectionStart, en = ta.selectionEnd;
      ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en); ta.selectionStart = ta.selectionEnd = s + 2;
    });
    return { node: h('div', { class: 'field' }, h('label', { for: id }, t(labelKey || 'pl.code')), ta, h('div', { class: 'help' }, t('pl.code.help'))), get: () => ta.value };
  }

  async function tabPlugins(panel, cfg, dirty, id, needRestart) {
    cfg.plugins = cfg.plugins || {};
    const composer = h('div');
    const list = h('div', { 'aria-live': 'polite' }, h('p', { class: 'muted' }, t('loading')));
    const sandboxNote = h('div');
    const running = () => ['running', 'starting'].includes(sp.summary?.status);

    // PUT {plugins:{name:patch}}; the server deep-merges, so omitted keys (untouched secrets) keep their value
    async function savePluginCfg(name, patch) {
      const r = await api('PUT', `/spaces/${enc(id)}`, { plugins: { [name]: patch } });
      if (r && r.errors && r.errors.length) throw new Error(r.errors.join('; '));
      cfg.plugins[name] = { ...(cfg.plugins[name] || {}), ...patch };   // keep the working copy in step for other tabs
      needRestart(r && r.restartNeeded);
      return r;
    }
    async function savePluginCode(name, code) {
      let r;
      try { r = await api('PUT', `/spaces/${enc(id)}/plugins/${enc(name)}`, { code }); }
      catch (e) { if (e.data && e.data.saved === false) return { saved: false, problems: e.data.problems || [e.message] }; throw e; }
      needRestart(r && r.restartNeeded && (cfg.plugins[name]?.enabled || running()));
      return r;
    }

    // ---- composer: AI draft or blank plugin → editor → save
    function openComposer(mode) {
      let lastRequest = '', lastName = '';
      const nameId = nextId('pn'), reqId = nextId('pr'), descId = nextId('pd');
      const out = h('div');
      const err = h('div', { class: 'errline', hidden: true });
      const showErr = (msg) => { err.textContent = msg; err.hidden = false; };
      const close = () => composer.replaceChildren();
      function showDraft(d) {
        // d: { name, code, ok?, problems?, meta? }
        const ed = codeEditor(d.code, 'pl.draftCode');
        const nm = { name: d.name || lastName || '' };
        const nmId = nextId('dn');
        const res = h('div', { 'aria-live': 'polite' });
        const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
          const name = nm.name.trim();
          if (!PLUGIN_NAME.test(name)) { res.replaceChildren(h('div', { class: 'errline' }, t('pl.badName'))); return; }
          const done = busy(saveBtn, t('saving')); res.replaceChildren();
          try {
            const r = await savePluginCode(name, ed.get());
            if (!r.saved) { res.replaceChildren(problemsBox(r.problems) || h('div', { class: 'errline' }, t('pl.notSaved'))); done(); return; }
            toast(t('pl.saved', { name }), 'ok'); close(); loadList(name);
          } catch (e) { res.replaceChildren(h('div', { class: 'errline' }, e.message)); done(); }
        } }, t('pl.save'));
        const regen = mode === 'ai' ? h('button', { class: 'btn', type: 'button', onclick: () => runDraft(lastRequest, lastName) }, t('pl.regenerate')) : null;
        out.replaceChildren(...[
          h('hr', { class: 'divider' }),
          h('div', { class: 'field', style: 'max-width:340px' }, h('label', { for: nmId }, t('pl.name')),
            h('input', { id: nmId, type: 'text', value: nm.name, spellcheck: 'false', 'aria-describedby': nmId + '-h', oninput: (e) => { nm.name = e.target.value.trim(); } }),
            h('div', { class: 'help', id: nmId + '-h' }, t('pl.name.help'))),
          d.meta ? h('div', { class: 'field' }, h('span', { class: 'label' }, t('pl.provides')), providesList(d.meta)) : null,
          problemsBox(d.problems),
          ed.node,
          h('p', { class: 'muted small' }, t('pl.saveNote')),
          res,
          h('div', { class: 'btn-row' }, saveBtn, regen, h('button', { class: 'btn ghost', type: 'button', onclick: close }, t('pl.discard'))),
        ].filter(Boolean));
      }
      async function runDraft(request, name) {
        lastRequest = request; lastName = name;
        err.hidden = true;
        const t0 = Date.now();
        const tick = h('span', {}, '0s');
        out.replaceChildren(h('div', { class: 'progress', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), t('pl.drafting'), ' ', tick, h('span', { class: 'muted small' }, ' · ', t('pl.draftingHint'))));
        draftBtn.disabled = true;
        const timer = setInterval(() => { if (!tick.isConnected) return clearInterval(timer); tick.textContent = Math.round((Date.now() - t0) / 1000) + 's'; }, 1000);
        try {
          const d = await api('POST', `/spaces/${enc(id)}/plugins/draft`, name ? { request, name } : { request });
          showDraft(d || {});
        } catch (e) {
          out.replaceChildren(problemsBox(e.data && e.data.problems) || h('div', { class: 'errline' }, e.message));
        } finally { clearInterval(timer); draftBtn.disabled = false; }
      }
      const draftBtn = h('button', { class: 'btn primary', type: 'button' }, t('pl.draft'));
      let form;
      if (mode === 'ai') {
        form = h('div', {},
          h('div', { class: 'field' }, h('label', { for: reqId }, t('pl.describe')), h('textarea', { id: reqId, rows: 4, class: 'prose', placeholder: t('pl.describe.ph'), 'aria-describedby': reqId + '-h' }), h('div', { class: 'help', id: reqId + '-h' }, t('pl.describe.help'))),
          h('div', { class: 'field', style: 'max-width:340px' }, h('label', { for: nameId }, t('pl.nameOptional')), h('input', { id: nameId, type: 'text', spellcheck: 'false', placeholder: 'keyword-alert', 'aria-describedby': nameId + '-h' }), h('div', { class: 'help', id: nameId + '-h' }, t('pl.name.help'))),
          err, h('div', { class: 'btn-row' }, draftBtn, h('button', { class: 'btn ghost', type: 'button', onclick: close }, t('wiz.cancel'))));
        draftBtn.addEventListener('click', () => {
          const request = form.querySelector('#' + reqId).value.trim(), name = form.querySelector('#' + nameId).value.trim();
          if (!request) { showErr(t('pl.describe.need')); form.querySelector('#' + reqId).focus(); return; }
          if (name && !PLUGIN_NAME.test(name)) { showErr(t('pl.badName')); return; }
          runDraft(request, name);
        });
      } else {
        const blankBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => {
          const name = form.querySelector('#' + nameId).value.trim(), desc = form.querySelector('#' + descId).value.trim() || t('pl.blankDesc');
          if (!PLUGIN_NAME.test(name)) { showErr(t('pl.badName')); return; }
          err.hidden = true; lastName = name; showDraft({ name, code: blankPlugin(name, desc) });
        } }, t('pl.startEditing'));
        form = h('div', {},
          h('div', { class: 'two' },
            h('div', { class: 'field' }, h('label', { for: nameId }, t('pl.name')), h('input', { id: nameId, type: 'text', spellcheck: 'false', placeholder: 'my-plugin', 'aria-describedby': nameId + '-h' }), h('div', { class: 'help', id: nameId + '-h' }, t('pl.name.help'))),
            h('div', { class: 'field' }, h('label', { for: descId }, t('pl.description')), h('input', { id: descId, type: 'text' }))),
          err, h('div', { class: 'btn-row' }, blankBtn, h('button', { class: 'btn ghost', type: 'button', onclick: close }, t('wiz.cancel'))));
      }
      composer.replaceChildren(h('div', { class: 'card' },
        h('h2', {}, t(mode === 'ai' ? 'pl.createAi' : 'pl.newBlank')),
        h('div', { class: 'warnbox' }, t('pl.codeWarning')),
        form, out));
      composer.querySelector('textarea, input')?.focus();
    }

    // ---- one card per plugin
    function pluginCard(p) {
      const meta = p.meta || null;
      const schema = meta?.configSchema || [];
      const settingsBox = h('div'), codeBox = h('div'), res = h('div', { 'aria-live': 'polite' });
      const enabledId = nextId('pe');
      const enabledBox = h('input', { id: enabledId, type: 'checkbox', checked: !!p.enabled, disabled: !meta, onchange: async (e) => {
        const on = e.target.checked; e.target.disabled = true; res.replaceChildren();
        try { await savePluginCfg(p.name, { enabled: on }); p.enabled = on; toast(t(on ? 'pl.enabled' : 'pl.disabled', { name: p.name }), 'ok'); }
        catch (err) { e.target.checked = !on; res.replaceChildren(h('div', { class: 'errline' }, err.message)); }
        e.target.disabled = !meta;
      } });
      function toggleSettings() {
        if (settingsBox.childNodes.length) return settingsBox.replaceChildren();
        const work = {};
        for (const f of schema) {
          const v = p.settings?.[f.key];
          work[f.key] = f.type === 'secret' ? (v ? KEEP : '') : clone(v);
          if (work[f.key] === null) delete work[f.key];
        }
        const saveBtn = h('button', { class: 'btn sm primary', type: 'button', onclick: async () => {
          const patch = {};
          // untouched ("__set__") or blank secrets are left out so a save never wipes a stored secret
          for (const f of schema) if (work[f.key] !== undefined && !(f.type === 'secret' && (work[f.key] === KEEP || work[f.key] === ''))) patch[f.key] = work[f.key];
          const done = busy(saveBtn, t('saving'));
          try { await savePluginCfg(p.name, patch); Object.assign(p.settings = p.settings || {}, patch); toast(t('saved'), 'ok'); settingsBox.replaceChildren(); }
          catch (e) { toast(e.message, 'err'); done(); }
        } }, t('pl.saveSettings'));
        settingsBox.replaceChildren(h('div', { class: 'plugin-sub' }, schema.map((f) => schemaField(f, work, null)),
          h('div', { class: 'btn-row' }, saveBtn, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => settingsBox.replaceChildren() }, t('wiz.cancel')))));
      }
      async function toggleCode(btn) {
        if (codeBox.childNodes.length) return codeBox.replaceChildren();
        const done = busy(btn, t('loading'));
        try {
          const r = await api('GET', `/spaces/${enc(id)}/plugins/${enc(p.name)}`);
          const ed = codeEditor(r.code, 'pl.code');
          const out = h('div', { 'aria-live': 'polite' });
          const saveBtn = h('button', { class: 'btn sm primary', type: 'button', onclick: async () => {
            const d2 = busy(saveBtn, t('saving')); out.replaceChildren();
            try {
              const s = await savePluginCode(p.name, ed.get());
              if (!s.saved) { out.replaceChildren(problemsBox(s.problems) || h('div', { class: 'errline' }, t('pl.notSaved'))); d2(); return; }
              toast(t('pl.saved', { name: p.name }), 'ok'); loadList(p.name);
            } catch (e) { out.replaceChildren(h('div', { class: 'errline' }, e.message)); d2(); }
          } }, t(r.scope !== 'space' ? 'pl.saveCopy' : 'pl.save'));
          codeBox.replaceChildren(h('div', { class: 'plugin-sub' },
            r.scope !== 'space' ? h('p', { class: 'muted small' }, t('pl.sharedEdit')) : null,
            ed.node, out,
            h('div', { class: 'btn-row' }, saveBtn, h('button', { class: 'btn sm ghost', type: 'button', onclick: () => codeBox.replaceChildren() }, t('pl.close')))));
        } catch (e) { codeBox.replaceChildren(h('div', { class: 'errline' }, e.message)); }
        done();
      }
      let armed = false;
      const delBtn = p.scope === 'space' ? h('button', { class: 'btn sm danger', type: 'button', onclick: async () => {
        if (!armed) { armed = true; delBtn.textContent = t('pl.deleteConfirm'); setTimeout(() => { if (delBtn.isConnected) { armed = false; delBtn.textContent = t('pl.delete'); } }, 4000); return; }
        const done = busy(delBtn, t('loading'));
        try {
          const r = await api('DELETE', `/spaces/${enc(id)}/plugins/${enc(p.name)}`);
          delete cfg.plugins[p.name]; needRestart(r && r.restartNeeded && p.enabled); toast(t('pl.deleted', { name: p.name }), 'ok'); loadList();
        } catch (e) { toast(e.message, 'err'); done(); }
      } }, t('pl.delete')) : null;
      const codeBtn = h('button', { class: 'btn sm', type: 'button', onclick: (e) => toggleCode(e.currentTarget) }, t('pl.viewCode'));
      return h('article', { class: 'conn plugin', id: 'plugin-' + p.name, 'aria-label': p.name },
        h('div', { class: 'conn-head' },
          h('span', { class: 'title' }, p.name), meta?.version ? h('span', { class: 'badge' }, 'v' + meta.version) : null,
          h('span', { class: 'badge' + (p.scope !== 'space' ? ' accent' : '') }, t(p.scope === 'builtin' ? 'pl.builtin' : p.scope === 'shared' ? 'pl.shared' : 'pl.spaceScope')),
          p.ok === false ? h('span', { class: 'badge warn' }, t('pl.hasProblems')) : null,
          h('span', { class: 'grow' }),
          h('label', { class: 'check small', for: enabledId }, enabledBox, t('conn.enabled'))),
        h('div', { class: 'conn-body' },
          meta?.description ? h('p', {}, meta.description) : null,
          h('div', { class: 'field' }, h('span', { class: 'label' }, t('pl.provides')), meta ? providesList(meta) : h('span', { class: 'muted small' }, t('pl.noLoad'))),
          problemsBox(p.problems),
          res,
          h('div', { class: 'conn-tools' },
            schema.length ? h('button', { class: 'btn sm', type: 'button', onclick: toggleSettings }, t('pl.settings')) : null,
            codeBtn, delBtn),
          settingsBox, codeBox));
    }

    async function loadList(focusName) {
      let items;
      try { items = await api('GET', `/spaces/${enc(id)}/plugins`); }
      catch (e) { list.replaceChildren(h('div', { class: 'errline' }, t('err.load'), ': ', e.message)); return; }
      items = Array.isArray(items) ? items : [];
      if (!items.length) { list.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, t('pl.empty.title')), h('p', {}, t('pl.empty.body')))); return; }
      items.sort((a, b) => (b.enabled - a.enabled) || (a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope === 'space' ? -1 : 1));
      list.replaceChildren(...items.map(pluginCard));
      if (focusName) list.querySelector('#plugin-' + CSS.escape(focusName))?.scrollIntoView({ block: 'nearest' });
    }

    panel.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'space-top' }, h('div', {}, h('h2', {}, t('tab.plugins')), h('p', { class: 'muted', style: 'margin:0' }, t('pl.intro'))),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn primary', type: 'button', onclick: () => openComposer('ai') }, '✦ ', t('pl.createAi')),
            h('button', { class: 'btn', type: 'button', onclick: () => openComposer('blank') }, '+ ', t('pl.newBlank')))),
        sandboxNote),
      composer, list);
    loadList();
    try {
      const s = await api('GET', '/settings');
      sandboxNote.replaceChildren(s && s.sandbox
        ? h('p', { class: 'okline', style: 'margin:12px 0 0' }, '✓ ', t('pl.sandboxOn'))
        : h('div', { class: 'warnbox', style: 'margin:12px 0 0' }, t('pl.sandboxOff'), ' ', h('a', { href: '#/settings' }, t('pl.sandboxLink'))));
    } catch { /* settings unavailable — no note */ }
  }

  function tabAi(panel, cfg, dirty, id) {
    cfg.ai = cfg.ai || {};
    const ai = cfg.ai;
    const hasOverride = () => !!(ai.base || ai.model || (ai.key && ai.key !== ''));
    let useGlobal = !hasOverride();
    const ug = nextId('ug');
    const overrides = h('div');
    const result = h('div', { 'aria-live': 'polite' });
    const drawOverrides = () => overrides.replaceChildren(...(useGlobal ? [] : [
      h('div', { class: 'two' },
        schemaField({ key: 'base', label: t('ai.base'), type: 'url' }, ai, dirty),
        schemaField({ key: 'model', label: t('ai.model'), type: 'string' }, ai, dirty)),
      schemaField({ key: 'key', label: t('ai.key'), type: 'secret' }, ai, dirty),
    ]));
    const testBtn = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      const done = busy(testBtn, t('conn.testing')); result.replaceChildren();
      try {
        const r = await api('POST', '/ai/test', useGlobal ? { space: id, useGlobal: true } : { base: ai.base, key: ai.key || KEEP, model: ai.model, space: id });
        result.replaceChildren(r && r.ok ? h('div', { class: 'okline' }, '✓ ', t('ai.testOk', { ms: r.ms ?? '?' }), r.sample ? ` — “${String(r.sample).slice(0, 80)}”` : '') : h('div', { class: 'errline' }, (r && r.error) || 'Failed'));
      } catch (e) { result.replaceChildren(h('div', { class: 'errline' }, e.message)); }
      done();
    } }, t('ai.test'));
    drawOverrides();
    panel.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'field' }, h('label', { class: 'check', for: ug }, h('input', { id: ug, type: 'checkbox', checked: useGlobal, 'aria-describedby': ug + '-h', onchange: (e) => {
        useGlobal = e.target.checked;
        if (useGlobal) { ai.base = ''; ai.model = ''; ai.key = ''; }
        dirty(); drawOverrides();
      } }), t('ai.useGlobal')), h('div', { class: 'help', id: ug + '-h' }, t('ai.useGlobal.help'))),
      overrides,
      h('hr', { class: 'divider' }),
      schemaField({ key: 'enabled', label: t('ai.enabled'), type: 'bool', default: true }, ai, dirty),
      schemaField({ key: 'pauseWhenNoViewer', label: t('ai.pause'), type: 'bool' }, ai, dirty),
      h('div', { style: 'max-width:260px' }, schemaField({ key: 'maxCallsPerHour', label: t('ai.maxCalls'), type: 'number' }, ai, dirty)),
      h('div', { class: 'conn-tools' }, testBtn), result));
  }

  // The hub owns cfg.ingest.token and returns it unmasked, so it can always be shown + copied.
  function tabAccess(panel, cfg, dirty) {
    cfg.auth = cfg.auth || {}; cfg.ingest = cfg.ingest || {};
    const port = sp.summary?.port || cfg.port || 5081;
    const tokBox = h('div');
    const drawToken = () => {
      const tok = cfg.ingest.token && cfg.ingest.token !== KEEP ? cfg.ingest.token : '';
      const example = `curl -X POST http://127.0.0.1:${port}/api/ingest/_space \\\n  -H "Authorization: Bearer ${tok || '<token>'}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"chatId":"alice","chatName":"Alice","senderName":"Alice","fromMe":false,"text":"hello"}'`;
      tokBox.replaceChildren(...[
        !tok ? h('p', { class: 'muted' }, t('acc.ingest.none')) : null,
        h('div', { class: 'token' }, tok ? h('code', {}, tok) : null, tok ? h('button', { class: 'btn sm', type: 'button', onclick: () => copyText(tok) }, t('acc.copy')) : null,
          h('button', { class: 'btn sm', type: 'button', onclick: () => { cfg.ingest.token = randomToken(); dirty(); drawToken(); toast(t('acc.saveToApply')); } }, tok ? t('acc.regen') : t('acc.gen'))),
        h('h3', { style: 'margin-top:16px' }, t('acc.example')),
        h('pre', { class: 'codeblock' }, example),
        h('p', { class: 'muted small', style: 'margin-top:8px' }, t('acc.docs'))].filter(Boolean));
    };
    drawToken();
    panel.replaceChildren(
      h('div', { class: 'card' }, h('h2', {}, t('acc.dash')),
        schemaField({ key: 'enabled', label: t('acc.authEnabled'), type: 'bool' }, cfg.auth, dirty),
        schemaField({ key: 'password', label: t('auth.password'), type: 'secret' }, cfg.auth, dirty)),
      h('div', { class: 'card' }, h('h2', {}, t('acc.ingest')), h('p', { class: 'muted' }, t('acc.ingest.help')), tokBox));
  }

  function tabLogs(panel, cfg, dirty, id) {
    const pre = h('pre', { class: 'logs', tabindex: '0', 'aria-label': t('tab.logs') }, t('loading'));
    let tail = 200, auto = true;
    const ai = nextId('au'), ti = nextId('tl');
    const load = async () => {
      try {
        const r = await api('GET', `/spaces/${enc(id)}/logs?tail=${tail}`);
        const lines = (r && r.lines) || [];
        const atBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 40;
        pre.textContent = lines.length ? lines.join('\n') : t('logs.empty');
        if (atBottom) pre.scrollTop = pre.scrollHeight;
      } catch (e) { pre.textContent = e.message; }
    };
    panel.replaceChildren(h('div', { class: 'btn-row', style: 'margin-bottom:10px' },
      h('label', { class: 'check', for: ai }, h('input', { id: ai, type: 'checkbox', checked: auto, onchange: (e) => { auto = e.target.checked; } }), t('logs.auto')),
      h('label', { for: ti, class: 'muted small' }, t('logs.tail')),
      h('select', { id: ti, style: 'width:auto', onchange: (e) => { tail = Number(e.target.value); load(); } }, [100, 200, 500, 1000].map((n) => h('option', { value: n, selected: n === tail }, n))),
      h('button', { class: 'btn sm', type: 'button', onclick: load }, t('logs.refresh'))), pre);
    load().then(() => { pre.scrollTop = pre.scrollHeight; });
    every(3000, () => { if (auto) load(); });
  }

  function tabDanger(panel, cfg, dirty, id) {
    const ci = nextId('cf'), pi = nextId('pg');
    let purge = false;
    const btn = h('button', { class: 'btn danger solid', type: 'button', disabled: true, onclick: async () => {
      const done = busy(btn, t('loading'));
      try { await api('DELETE', `/spaces/${enc(id)}${purge ? '?purge=1' : ''}`); toast(t('danger.deleted', { name: cfg.name || id }), 'ok'); sp = null; location.hash = '#/'; }
      catch (e) { toast(e.message, 'err'); done(); }
    } }, t('danger.btn'));
    panel.replaceChildren(h('div', { class: 'card', style: 'border-color:var(--err)' },
      h('h2', {}, t('danger.delete')), h('p', { class: 'muted' }, t('danger.delete.help')),
      h('div', { class: 'field' }, h('label', { class: 'check', for: pi }, h('input', { id: pi, type: 'checkbox', onchange: (e) => { purge = e.target.checked; } }), t('danger.purge'))),
      h('div', { class: 'field', style: 'max-width:340px' }, h('label', { for: ci }, t('danger.confirm', { id })),
        h('input', { id: ci, type: 'text', autocomplete: 'off', spellcheck: 'false', oninput: (e) => { btn.disabled = e.target.value.trim() !== id; } })),
      btn));
  }

  // ---------------------------------------------------------------- global settings
  async function viewSettings() {
    shell('settings', h('p', { class: 'muted' }, t('loading')));
    let settings, spaces;
    try { [settings, spaces] = await Promise.all([api('GET', '/settings'), api('GET', '/spaces').catch(() => [])]); }
    catch (e) { shell('settings', h('div', { class: 'errline' }, t('err.load'), ': ', e.message)); return; }
    settings = settings || {}; settings.ai = settings.ai || {}; settings.episodeRouter = settings.episodeRouter || {};
    settings.sandbox = !!settings.sandbox;
    const savebar = h('div', { class: 'savebar', hidden: true });
    const markDirty = () => { savebar.hidden = false; };
    const saveBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
      const done = busy(saveBtn, t('saving'));
      try { const r = await api('PUT', '/settings', settings); if (r && r.errors && r.errors.length) throw new Error(r.errors.join('; ')); toast(t('saved'), 'ok'); viewSettings(); }
      catch (e) { toast(e.message, 'err'); done(); }
    } }, t('save'));
    savebar.replaceChildren(h('span', { class: 'dirty' }, t('unsaved')), h('div', { class: 'btn-row' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => viewSettings() }, t('discard')), saveBtn));
    const aiRes = h('div', { 'aria-live': 'polite' });
    const aiTest = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      const done = busy(aiTest, t('conn.testing')); aiRes.replaceChildren();
      try {
        const a = settings.ai;
        const r = await api('POST', '/ai/test', { base: a.base, key: a.key || KEEP, model: a.model });
        aiRes.replaceChildren(r && r.ok ? h('div', { class: 'okline' }, '✓ ', t('ai.testOk', { ms: r.ms ?? '?' }), r.sample ? ` — “${String(r.sample).slice(0, 80)}”` : '') : h('div', { class: 'errline' }, (r && r.error) || 'Failed'));
      } catch (e) { aiRes.replaceChildren(h('div', { class: 'errline' }, e.message)); }
      done();
    } }, t('ai.test'));
    const review = h('div', {}, h('p', { class: 'muted' }, t('loading')));
    shell('settings', [
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, t('gs.title')), h('div', { class: 'sub' }, t('gs.sub')))),
      h('div', { class: 'card' }, h('h2', {}, t('gs.ai')), h('p', { class: 'muted' }, t('gs.ai.help')),
        h('div', { class: 'two' },
          schemaField({ key: 'base', label: t('ai.base'), type: 'url', required: true, placeholder: 'https://api.openai.com/v1' }, settings.ai, markDirty),
          schemaField({ key: 'model', label: t('ai.model'), type: 'string', required: true }, settings.ai, markDirty)),
        schemaField({ key: 'key', label: t('ai.key'), type: 'secret', required: true }, settings.ai, markDirty),
        h('div', { style: 'max-width:260px' }, schemaField({ key: 'maxCallsPerHour', label: t('ai.maxCalls'), type: 'number' }, settings.ai, markDirty)),
        h('div', { class: 'conn-tools' }, aiTest), aiRes),
      h('div', { class: 'card' }, h('h2', {}, t('gs.workers')),
        schemaField({ key: 'sandbox', label: t('gs.sandbox'), type: 'bool' }, settings, markDirty)),
      h('div', { class: 'card' }, h('h2', {}, t('gs.router')), h('p', { class: 'muted' }, t('gs.router.help')),
        schemaField({ key: 'enabled', label: t('gs.router.enabled'), type: 'bool' }, settings.episodeRouter, markDirty),
        schemaField({ key: 'inbox', label: t('gs.router.inbox'), type: 'path' }, settings.episodeRouter, markDirty),
        h('div', { style: 'max-width:260px' }, schemaField({ key: 'minConfidence', label: t('gs.router.min'), type: 'number', help: t('gs.router.min.help') }, settings.episodeRouter, markDirty))),
      h('div', { class: 'card' }, h('h2', {}, t('rv.title')), review),
      savebar]);
    loadReview(review, spaces || []);
  }
  async function loadReview(box, spaces) {
    let items;
    try { items = await api('GET', '/episodes/review'); } catch (e) { box.replaceChildren(h('div', { class: 'errline' }, e.message)); return; }
    items = Array.isArray(items) ? items : [];
    if (!items.length) { box.replaceChildren(h('p', { class: 'muted' }, t('rv.empty'))); return; }
    box.replaceChildren(...items.map((it, idx) => {
      const sugg = new Map((it.suggested || []).map((s) => [s.space, s.score]));
      const checks = spaces.map((s) => ({ s, input: h('input', { type: 'checkbox', checked: sugg.has(s.id) }) }));
      const btn = h('button', { class: 'btn sm primary', type: 'button', onclick: async () => {
        const sel = checks.filter((c) => c.input.checked).map((c) => c.s.id);
        if (!sel.length) { toast(t('rv.pick'), 'err'); return; }
        const done = busy(btn, t('loading'));
        try { await api('POST', `/episodes/${enc(it.id)}/route`, { spaces: sel }); toast(t('rv.routed'), 'ok'); node.remove(); if (!box.querySelector('.review-item')) box.replaceChildren(h('p', { class: 'muted' }, t('rv.empty'))); }
        catch (e) { toast(e.message, 'err'); done(); }
      } }, t('rv.route'));
      const node = h('div', { class: 'review-item', style: idx ? 'border-top:1px solid var(--line);padding-top:14px;margin-top:14px' : null },
        h('div', { class: 'space-top' }, h('strong', {}, it.title || it.id), h('span', { class: 'muted small' }, fmtTime(it.ts))),
        it.excerpt ? h('div', { class: 'excerpt' }, it.excerpt) : null,
        h('div', { class: 'review-spaces', role: 'group', 'aria-label': it.title || it.id }, checks.map(({ s, input }) => h('label', { class: 'check small' }, input, s.name,
          sugg.has(s.id) ? h('span', { class: 'badge accent' }, t('rv.suggested', { score: Number(sugg.get(s.id)).toFixed(2) })) : null))),
        h('div', {}, btn));
      return node;
    }));
  }

  // ---------------------------------------------------------------- router + boot
  function route() {
    clearTimers();
    if (!state.authed) return state.setupNeeded ? viewSetup() : viewLogin();
    const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    if (parts[0] !== 'new') wz = null;
    if (parts[0] !== 'space') sp = null;
    if (parts[0] === 'new') return viewWizard();
    if (parts[0] === 'space' && parts[1]) {
      if (sp && sp.id !== parts[1]) sp = null;
      return viewSpace(parts[1], parts[2] || 'general');
    }
    if (parts[0] === 'settings') return viewSettings();
    return viewHome();
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => { if (sp && sp.dirty) { e.preventDefault(); e.returnValue = ''; } });

  async function boot() {
    try {
      const s = await api('GET', '/session');
      state.authed = !!(s && s.authed); state.setupNeeded = !!(s && s.setupNeeded);
      if (state.authed) state.meta = await api('GET', '/meta');
    } catch (e) {
      app().replaceChildren(h('div', { class: 'auth' }, h('div', { class: 'card' }, h('h1', {}, t('app.name')), h('div', { class: 'errline', style: 'margin:12px 0' }, e.message),
        h('button', { class: 'btn primary', type: 'button', onclick: boot }, t('logs.refresh')))));
      return;
    }
    route();
  }
  boot();
})();
