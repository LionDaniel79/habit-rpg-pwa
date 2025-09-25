/* eslint-disable no-console */
(function () {
  const STORAGE_KEYS = {
    queue: 'habit-rpg-offline-queue',
    state: 'habit-rpg-state-cache',
    device: 'habit-rpg-device-id',
    apiBase: 'habit-rpg-api-base'
  };

  const DEFAULT_API_BASE = (() => {
    const stored = localStorage.getItem(STORAGE_KEYS.apiBase);
    if (stored) return stored;
    if (location.hostname === 'localhost') {
      return 'http://localhost:4000';
    }
    return 'https://your-backend-url.example.com';
  })();

  const state = {
    deviceId: ensureDeviceId(),
    apiBase: localStorage.getItem(STORAGE_KEYS.apiBase) || DEFAULT_API_BASE,
    user: null,
    config: {},
    domains: [],
    quests: [],
    queue: loadQueue(),
    activeTab: 'today',
    isOnline: navigator.onLine,
    syncing: false
  };

  const elements = {
    connectionStatus: document.getElementById('connection-status'),
    domainTrack: document.getElementById('domain-track'),
    carouselButtons: document.querySelectorAll('.carousel-control'),
    tabButtons: document.querySelectorAll('.tab-button'),
    questList: document.getElementById('quest-list'),
    addQuestButton: document.getElementById('add-quest'),
    questDialog: document.getElementById('quest-dialog'),
    questForm: document.getElementById('quest-form'),
    settingsDialog: document.getElementById('settings-dialog'),
    settingsForm: document.getElementById('settings-form'),
    rewardToast: document.getElementById('reward-toast'),
    questTemplate: document.getElementById('quest-card-template'),
    audio: {
      chime: document.getElementById('sound-reward-chime'),
      fanfare: document.getElementById('sound-reward-fanfare')
    }
  };

  let queueProcessing = false;

  /* ----------------------------------------------------------
   * 초기 설정 및 유틸리티
   * -------------------------------------------------------- */
  function ensureDeviceId() {
    let deviceId = localStorage.getItem(STORAGE_KEYS.device);
    if (!deviceId) {
      deviceId = (crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}`);
      localStorage.setItem(STORAGE_KEYS.device, deviceId);
    }
    return deviceId;
  }

  function loadQueue() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.queue);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('큐 로드 실패, 초기화합니다.', error);
      return [];
    }
  }

  function persistQueue() {
    localStorage.setItem(STORAGE_KEYS.queue, JSON.stringify(state.queue));
    updateConnectionStatus();
  }

  function persistState() {
    const cache = {
      user: state.user,
      config: state.config,
      domains: state.domains,
      quests: state.quests
    };
    localStorage.setItem(STORAGE_KEYS.state, JSON.stringify(cache));
  }

  function loadCachedState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.state);
      if (!raw) return;
      const cached = JSON.parse(raw);
      if (cached.user) state.user = cached.user;
      if (cached.config) state.config = cached.config;
      if (Array.isArray(cached.domains)) state.domains = cached.domains;
      if (Array.isArray(cached.quests)) state.quests = cached.quests;
    } catch (error) {
      console.warn('캐시 로드 실패', error);
    }
  }

  function setApiBase(url) {
    state.apiBase = url;
    localStorage.setItem(STORAGE_KEYS.apiBase, url);
  }

  function updateConnectionStatus(message) {
    const indicator = elements.connectionStatus;
    const parts = [];
    parts.push(state.isOnline ? '🟢 온라인' : '🔴 오프라인');
    if (typeof message === 'string') {
      parts.push(message);
    }
    if (state.queue.length) {
      parts.push(`대기중 ${state.queue.length}건`);
    }
    indicator.textContent = parts.join(' · ');
  }

  function formatDate(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.valueOf())) return value;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function getDomainMeta(name) {
    return state.domains.find((domain) => domain.name === name);
  }

  function findQueueConflicts(questId) {
    return state.queue.some((item) => {
      if (!item) return false;
      if (item.type === 'createQuest') {
        return item.tempId === questId;
      }
      return item.questId === questId;
    });
  }

  /* ----------------------------------------------------------
   * 네트워크 호출 래퍼 & 동기화 로직
   * -------------------------------------------------------- */
  async function apiRequest(path, options = {}) {
    const url = new URL(path, state.apiBase).toString();
    const headers = {
      'Content-Type': 'application/json',
      'X-Device-ID': state.deviceId,
      ...(options.headers || {})
    };
    const config = {
      ...options,
      headers
    };
    const response = await fetch(url, config);
    if (!response.ok) {
      const error = new Error(`API 요청 실패 (${response.status})`);
      error.status = response.status;
      error.body = await response.json().catch(() => ({}));
      throw error;
    }
    return response;
  }

  function applySnapshotData(data) {
    if (!data) return;
    if (data.user) {
      state.user = data.user;
    } else if (!state.user) {
      state.user = { id: state.deviceId };
    }
    if (data.config) {
      state.config = data.config;
    }
    if (Array.isArray(data.domains)) {
      state.domains = data.domains;
    }
    if (Array.isArray(data.quests)) {
      const optimisticQuests = state.quests.filter((quest) => quest.optimistic);
      const incoming = data.quests
        .filter((quest) => !findQueueConflicts(quest.id))
        .map((quest) => ({ ...quest, optimistic: false }));
      state.quests = [...incoming, ...optimisticQuests];
    }
    persistState();
    renderAll();
  }

  async function bootstrap() {
    try {
      const response = await apiRequest('/api/bootstrap', { method: 'POST', body: JSON.stringify({}) });
      const data = await response.json();
      applySnapshotData(data);
      updateConnectionStatus('초기 데이터 동기화 완료');
    } catch (error) {
      console.warn('부트스트랩 실패, 캐시 사용', error);
      loadCachedState();
      renderAll();
      updateConnectionStatus('오프라인 캐시 데이터 표시 중');
    }
  }

  async function fetchSnapshot() {
    if (!state.isOnline || state.syncing) return;
    state.syncing = true;
    try {
      const response = await apiRequest('/api/snapshot', { method: 'GET' });
      const data = await response.json();
      applySnapshotData(data);
    } catch (error) {
      console.warn('스냅샷 동기화 실패', error);
    } finally {
      state.syncing = false;
    }
  }

  function enqueueOperation(operation) {
    state.queue.push({ ...operation, enqueuedAt: new Date().toISOString() });
    persistQueue();
  }

  async function flushQueue() {
    if (!state.isOnline || queueProcessing || state.queue.length === 0) {
      return;
    }
    queueProcessing = true;
    const remaining = [];

    for (const operation of state.queue) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await processOperation(operation);
      } catch (error) {
        console.warn('오프라인 큐 처리 실패', error);
        const retries = operation.retries ? operation.retries + 1 : 1;
        if (retries < 4 && (error.status === undefined || error.status >= 500)) {
          remaining.push({ ...operation, retries });
        } else {
          updateConnectionStatus('일부 작업 동기화 실패 (로그 확인)');
        }
      }
    }

    state.queue = remaining;
    persistQueue();
    queueProcessing = false;
  }

  async function processOperation(operation) {
    switch (operation.type) {
      case 'createQuest': {
        const response = await apiRequest('/api/quests', {
          method: 'POST',
          body: JSON.stringify(operation.payload)
        });
        const data = await response.json();
        replaceTempQuest(operation.tempId, data.quest);
        break;
      }
      case 'updateQuest': {
        const response = await apiRequest(`/api/quests/${operation.questId}`, {
          method: 'PATCH',
          body: JSON.stringify(operation.payload)
        });
        const data = await response.json();
        updateQuestInState(data.quest);
        break;
      }
      case 'deleteQuest': {
        await apiRequest(`/api/quests/${operation.questId}`, { method: 'DELETE' });
        removeQuestFromState(operation.questId);
        break;
      }
      case 'completeQuest': {
        const response = await apiRequest(`/api/quests/${operation.questId}/complete`, {
          method: 'POST'
        });
        const data = await response.json();
        applyQuestCompletion(data);
        break;
      }
      case 'updateConfig': {
        const response = await apiRequest('/api/config', {
          method: 'PATCH',
          body: JSON.stringify(operation.payload)
        });
        const data = await response.json();
        state.config = data.config;
        persistState();
        renderDomains();
        break;
      }
      default:
        console.warn('알 수 없는 큐 작업', operation);
    }
  }

  /* ----------------------------------------------------------
   * 상태 조작 헬퍼
   * -------------------------------------------------------- */
  function replaceTempQuest(tempId, quest) {
    const index = state.quests.findIndex((item) => item.id === tempId);
    if (index >= 0) {
      state.quests[index] = { ...quest, optimistic: false };
    } else {
      state.quests.push({ ...quest, optimistic: false });
    }
    persistState();
    renderQuests();
  }

  function addQuestToState(quest) {
    state.quests.push(quest);
    persistState();
    renderQuests();
  }

  function updateQuestInState(quest) {
    const index = state.quests.findIndex((item) => item.id === quest.id);
    if (index >= 0) {
      state.quests[index] = { ...state.quests[index], ...quest, optimistic: false };
    }
    persistState();
    renderQuests();
  }

  function removeQuestFromState(id) {
    state.quests = state.quests.filter((quest) => quest.id !== id);
    persistState();
    renderQuests();
  }

  function applyQuestCompletion(payload) {
    if (payload.quest) {
      updateQuestInState(payload.quest);
    }
    if (Array.isArray(payload.domains)) {
      payload.domains.forEach((updated) => {
        const index = state.domains.findIndex((domain) => domain.id === updated.id || domain.name === updated.name);
        if (index >= 0) {
          state.domains[index] = { ...state.domains[index], ...updated };
        }
      });
      renderDomains();
    }
    if (payload.nextQuest) {
      addQuestToState({ ...payload.nextQuest, optimistic: false });
    }
    if (Array.isArray(payload.levelUpEvents) && payload.levelUpEvents.length) {
      const rewardEvent = payload.levelUpEvents.find((event) => event.reward_text);
      if (rewardEvent) {
        showRewardToast(`${rewardEvent.domain_name} ${rewardEvent.new_level}레벨 달성! ${rewardEvent.reward_text}`, rewardEvent.reward_sound);
      }
    }
    persistState();
  }

  /* ----------------------------------------------------------
   * 렌더링 로직
   * -------------------------------------------------------- */
  function renderAll() {
    renderDomains();
    renderQuests();
  }

  function renderDomains() {
    const track = elements.domainTrack;
    track.innerHTML = '';
    state.domains.forEach((domain) => {
      const card = document.createElement('article');
      card.className = 'domain-card';
      card.style.border = `1px solid ${domain.color || 'rgba(56,189,248,0.4)'}`;

      const header = document.createElement('div');
      header.className = 'domain-header';
      const icon = document.createElement('div');
      icon.className = 'domain-icon';
      icon.style.background = `${domain.color || 'rgba(56,189,248,0.3)'}`;
      icon.textContent = domain.name.charAt(0);
      const title = document.createElement('div');
      title.innerHTML = `<strong>${domain.name}</strong><br /><small>Lv.${domain.level}</small>`;
      header.append(icon, title);

      const progress = document.createElement('div');
      progress.className = 'progress-bar';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      const thresholds = Array.isArray(domain.level_thresholds)
        ? domain.level_thresholds
        : state.config.default_level_thresholds || [];
      const nextThreshold = domain.next_level_threshold || thresholds[domain.level] || domain.xp + 100;
      const prevThreshold = thresholds[Math.max(0, domain.level - 1)] || 0;
      const ratio =
        typeof domain.level_progress_ratio === 'number'
          ? domain.level_progress_ratio
          : Math.max(0, Math.min(1, (domain.xp - prevThreshold) / Math.max(1, nextThreshold - prevThreshold)));
      fill.style.width = `${Math.round(ratio * 100)}%`;
      fill.style.background = domain.color || 'var(--accent)';
      progress.appendChild(fill);

      const footer = document.createElement('div');
      footer.className = 'domain-footer';
      const xpToNext =
        typeof domain.xp_to_next_level === 'number'
          ? domain.xp_to_next_level
          : Math.max(0, Math.round(nextThreshold - domain.xp));
      footer.innerHTML = `<span>${domain.xp} XP</span><span>다음 레벨까지 ${xpToNext} XP</span>`;

      card.append(header, progress, footer);
      track.appendChild(card);
    });
  }

  function groupQuests() {
    const today = formatDate(new Date());
    const tomorrow = formatDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const groups = {
      today: [],
      tomorrow: [],
      upcoming: []
    };
    const quests = [...state.quests].sort((a, b) => new Date(a.date) - new Date(b.date));
    quests.forEach((quest) => {
      if (quest.is_completed) return;
      if (quest.date === today) {
        groups.today.push(quest);
      } else if (quest.date === tomorrow) {
        groups.tomorrow.push(quest);
      } else {
        groups.upcoming.push(quest);
      }
    });
    return groups;
  }

  function renderQuests() {
    const groups = groupQuests();
    const activeQuests = groups[state.activeTab] || [];
    const list = elements.questList;
    list.innerHTML = '';

    if (!activeQuests.length) {
      const empty = document.createElement('p');
      empty.textContent = '표시할 퀘스트가 없습니다. 상단 버튼으로 새 퀘스트를 추가해보세요!';
      empty.className = 'quest-empty';
      list.appendChild(empty);
      return;
    }

    activeQuests.forEach((quest) => {
      const card = elements.questTemplate.content.firstElementChild.cloneNode(true);
      card.dataset.questId = quest.id;
      if (quest.optimistic) {
        card.style.opacity = '0.7';
      }
      card.querySelector('.quest-title').textContent = quest.title;
      const domain = getDomainMeta(quest.domain_name);
      const domainName = domain ? domain.name : quest.domain_name;
      const metaParts = [`${domainName}`, `${quest.xp} XP`, `목표일 ${quest.date}`];
      if (quest.is_daily) {
        metaParts.push('반복');
      }
      if (quest.notes) {
        metaParts.push(`메모: ${quest.notes}`);
      }
      card.querySelector('.quest-meta').textContent = metaParts.join(' · ');
      list.appendChild(card);
    });
  }

  function setActiveTab(tab) {
    state.activeTab = tab;
    elements.tabButtons.forEach((button) => {
      const isActive = button.dataset.tab === tab;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });
    renderQuests();
  }

  function showRewardToast(message, soundKey = 'chime') {
    const toast = elements.rewardToast;
    toast.textContent = message;
    toast.hidden = false;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      toast.hidden = true;
    }, 3000);

    const audio = elements.audio[soundKey === 'reward-fanfare' ? 'fanfare' : 'chime'];
    if (audio) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }
  }

  /* ----------------------------------------------------------
   * 이벤트 바인딩
   * -------------------------------------------------------- */
  function bindEvents() {
    elements.carouselButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const direction = button.dataset.direction;
        const track = elements.domainTrack;
        const scrollAmount = track.clientWidth * 0.9;
        track.scrollBy({
          left: direction === 'next' ? scrollAmount : -scrollAmount,
          behavior: 'smooth'
        });
      });
    });

    elements.tabButtons.forEach((button) => {
      button.addEventListener('click', () => {
        setActiveTab(button.dataset.tab);
      });
    });

    elements.addQuestButton.addEventListener('click', () => openQuestDialog());

    elements.questForm.addEventListener('submit', handleQuestSubmit);
    elements.questForm.addEventListener('reset', () => elements.questDialog.close());

    elements.settingsForm.addEventListener('submit', handleSettingsSubmit);
    elements.settingsForm.addEventListener('reset', () => elements.settingsDialog.close());

    elements.questList.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const card = button.closest('.quest-card');
      const questId = card?.dataset.questId;
      if (!questId) return;
      const quest = state.quests.find((item) => item.id === questId);
      if (!quest) return;
      const action = button.dataset.action;
      if (action === 'complete') {
        handleQuestCompletion(quest);
      } else if (action === 'postpone') {
        handleQuestPostpone(quest);
      } else if (action === 'edit') {
        openQuestDialog(quest);
      } else if (action === 'delete') {
        handleQuestDelete(quest);
      }
    });

    document.getElementById('open-settings').addEventListener('click', () => openSettingsDialog());

    window.addEventListener('online', () => {
      state.isOnline = true;
      updateConnectionStatus('온라인 전환, 동기화 시도 중');
      flushQueue().then(() => fetchSnapshot());
    });

    window.addEventListener('offline', () => {
      state.isOnline = false;
      updateConnectionStatus('오프라인 모드');
    });
  }

  function openQuestDialog(quest) {
    const form = elements.questForm;
    form.reset();
    const domainSelect = form.elements.domain_name;
    domainSelect.innerHTML = '';
    state.domains.forEach((domain) => {
      const option = document.createElement('option');
      option.value = domain.name;
      option.textContent = domain.name;
      domainSelect.appendChild(option);
    });

    const today = formatDate(new Date());
    form.elements.date.value = today;

    if (quest) {
      form.elements.title.value = quest.title;
      form.elements.xp.value = quest.xp;
      form.elements.domain_name.value = quest.domain_name;
      form.elements.date.value = quest.date;
      form.elements.is_daily.checked = Boolean(quest.is_daily);
      form.elements.notes.value = quest.notes || '';
      form.elements.id.value = quest.id;
      document.getElementById('quest-dialog-title').textContent = '퀘스트 수정';
    } else {
      document.getElementById('quest-dialog-title').textContent = '퀘스트 추가';
      form.elements.id.value = '';
    }

    elements.questDialog.showModal();
  }

  async function handleQuestSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const questPayload = {
      title: formData.get('title'),
      xp: Number(formData.get('xp')),
      domain_name: formData.get('domain_name'),
      date: formatDate(formData.get('date')),
      is_daily: formData.get('is_daily') === 'on',
      notes: formData.get('notes') || null
    };

    if (!questPayload.title || !questPayload.title.trim()) {
      alert('퀘스트 제목을 입력해주세요.');
      return;
    }
    if (!Number.isFinite(questPayload.xp) || questPayload.xp <= 0) {
      alert('XP는 1 이상의 숫자여야 합니다.');
      return;
    }

    const id = formData.get('id');
    elements.questDialog.close();

    if (id) {
      await updateQuest(id, questPayload);
    } else {
      await createQuest(questPayload);
    }
  }

  async function handleSettingsSubmit(event) {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);
    const updates = {};

    const willpower = formData.get('willpower_xp_per_any_quest');
    if (willpower) {
      updates.willpower_xp_per_any_quest = Number(willpower);
    }

    const thresholds = formData.get('default_level_thresholds');
    if (thresholds) {
      updates.default_level_thresholds = thresholds
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => !Number.isNaN(value));
    }

    const rewards = formData.get('default_levelup_rewards');
    if (rewards) {
      try {
        updates.default_levelup_rewards = JSON.parse(rewards);
      } catch (error) {
        alert('보상 목록은 JSON 형식이어야 합니다. 예: [{"level":2,"text":"축하"}]');
        return;
      }
    }

    const apiBaseUrl = formData.get('api_base_url');
    if (apiBaseUrl) {
      setApiBase(apiBaseUrl);
    }

    elements.settingsDialog.close();

    if (Object.keys(updates).length === 0) {
      updateConnectionStatus('변경된 설정이 없습니다');
      return;
    }

    if (!state.isOnline) {
      state.config = { ...state.config, ...updates };
      persistState();
      renderDomains();
      enqueueOperation({ type: 'updateConfig', payload: updates });
      updateConnectionStatus('오프라인 상태에서 설정 변경이 큐에 저장되었습니다');
      return;
    }

    try {
      const response = await apiRequest('/api/config', {
        method: 'PATCH',
        body: JSON.stringify(updates)
      });
      const data = await response.json();
      state.config = data.config;
      persistState();
      renderDomains();
      updateConnectionStatus('설정이 업데이트되었습니다');
    } catch (error) {
      console.error('설정 업데이트 실패', error);
      updateConnectionStatus('설정 업데이트 중 오류 발생');
    }
  }

  async function createQuest(payload) {
    const tempId = `temp-${Date.now()}`;
    const optimisticQuest = { ...payload, id: tempId, optimistic: true, date: formatDate(payload.date) };
    addQuestToState(optimisticQuest);

    if (!state.isOnline) {
      enqueueOperation({ type: 'createQuest', payload, tempId });
      return;
    }

    try {
      const response = await apiRequest('/api/quests', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      replaceTempQuest(tempId, data.quest);
      await fetchSnapshot();
    } catch (error) {
      console.error('퀘스트 생성 실패', error);
      enqueueOperation({ type: 'createQuest', payload, tempId });
      updateConnectionStatus('퀘스트 생성이 큐에 저장되었습니다');
    }
  }

  async function updateQuest(id, payload) {
    updateQuestInState({ id, ...payload, optimistic: true });

    if (!state.isOnline) {
      enqueueOperation({ type: 'updateQuest', questId: id, payload });
      return;
    }

    try {
      const response = await apiRequest(`/api/quests/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      updateQuestInState(data.quest);
    } catch (error) {
      console.error('퀘스트 업데이트 실패', error);
      enqueueOperation({ type: 'updateQuest', questId: id, payload });
    }
  }

  async function handleQuestDelete(quest) {
    removeQuestFromState(quest.id);

    if (!state.isOnline) {
      enqueueOperation({ type: 'deleteQuest', questId: quest.id });
      return;
    }

    try {
      await apiRequest(`/api/quests/${quest.id}`, {
        method: 'DELETE'
      });
    } catch (error) {
      console.error('퀘스트 삭제 실패', error);
      enqueueOperation({ type: 'deleteQuest', questId: quest.id });
    }
  }

  async function handleQuestPostpone(quest) {
    const nextDate = formatDate(new Date(Date.parse(quest.date) + 24 * 60 * 60 * 1000));
    await updateQuest(quest.id, { date: nextDate });
  }

  async function handleQuestCompletion(quest) {
    updateQuestInState({ ...quest, is_completed: true, optimistic: true });

    if (!state.isOnline) {
      enqueueOperation({ type: 'completeQuest', questId: quest.id });
      return;
    }

    try {
      const response = await apiRequest(`/api/quests/${quest.id}/complete`, {
        method: 'POST'
      });
      const data = await response.json();
      applyQuestCompletion(data);
    } catch (error) {
      console.error('퀘스트 완료 실패', error);
      enqueueOperation({ type: 'completeQuest', questId: quest.id });
    }
  }

  function openSettingsDialog() {
    const form = elements.settingsForm;
    form.reset();
    form.elements.willpower_xp_per_any_quest.value = state.config.willpower_xp_per_any_quest || 0;
    form.elements.api_base_url.value = state.apiBase;
    if (Array.isArray(state.config.default_level_thresholds)) {
      form.elements.default_level_thresholds.value = state.config.default_level_thresholds.join(',');
    }
    form.elements.default_levelup_rewards.value = JSON.stringify(state.config.default_levelup_rewards || [], null, 2);
    elements.settingsDialog.showModal();
  }

  /* ----------------------------------------------------------
   * 초기 실행
   * -------------------------------------------------------- */
  bindEvents();
  loadCachedState();
  renderAll();
  updateConnectionStatus('초기 데이터 로딩 중');
  bootstrap().then(() => {
    flushQueue();
    setInterval(fetchSnapshot, 60_000);
  });
})();