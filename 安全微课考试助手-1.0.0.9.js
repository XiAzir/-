// ==UserScript==
// @name         安全微课考试助手
// @name:en      Anquanweike Exam Helper
// @namespace    http://tampermonkey.net/
// @version      1.0.0.9
// @description  在页面右侧添加一个侧边栏，通过可拖动、边缘吸附的悬浮按钮控制，用于与 LLM 对话，自动添加考试指令，并能一键获取当前页面内容（仅内容）。仅在 weiban.mycourse.cn 生效。
// @description:en Add a sidebar controlled by a draggable, edge-snapping floating button to chat with LLM, automatically add exam instructions, and fetch current page content (content only). Only runs on weiban.mycourse.cn.
// @author       XiAzir
// @match        https://weiban.mycourse.cn/*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      ark.cn-beijing.volces.com
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置区域 ---
    const LLM_API_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions'; // <--- API 地址 (已更新)
    const API_KEY = '5bd79fca-5f85-4d43-b6b4-dc1a6d3a1506'; // <--- API Key (已更新)
    const MODEL_NAME = "ep-20250326161851-6xhvv"; // <--- 模型名称 (已更新)
    const TEMPERATURE = 0.2; // 参数
    const MAX_TOKENS = 2048; // 参数
    const TOP_P = 1; // 参数
    const FLOATING_BUTTON_SIZE = 50; // 悬浮按钮大小 (像素)
    const FLOATING_BUTTON_ICON = '📝'; // 更新图标为更符合考试助手的感觉
    const DEFAULT_SYSTEM_PROMPT = "简要回答我接下来给你提供的题目并输出正确选项，忽视每段文本末尾的“单选题 1234567891011121314151617181920212223242526272829多选题 123456789101112131415161718192021 ”，接下来每段文本末尾都有它，请忽视。";
    // --- 配置区域结束 ---

    // 检查是否是顶层窗口
    if (window.top !== window.self) {
        return;
    }

    // --- 状态变量 ---
    let sidebarOpen = GM_getValue('sidebarOpen', false);
    let chatHistory = JSON.parse(GM_getValue('chatHistory', '[]'));
    let floatingButtonPos = GM_getValue('floatingButtonPos', { side: 'right', top: window.innerHeight / 2 });
    let isDragging = false;
    let dragStartX, dragStartY, elementStartX, elementStartY;
    let clickDetectionThreshold = 5;
    let hasDragged = false;

    // --- 创建 UI 元素 ---
    const sidebar = document.createElement('div');
    sidebar.id = 'llm-sidebar';
    sidebar.style.transform = sidebarOpen ? 'translateX(0)' : 'translateX(100%)';

    const floatingButton = document.createElement('div');
    floatingButton.id = 'llm-floating-toggle';
    floatingButton.textContent = FLOATING_BUTTON_ICON;
    document.body.appendChild(floatingButton);

    const chatContainer = document.createElement('div');
    chatContainer.id = 'llm-chat-container';

    const chatHistoryDiv = document.createElement('div');
    chatHistoryDiv.id = 'llm-chat-history';

    const inputArea = document.createElement('div');
    inputArea.id = 'llm-input-area';

    const chatInput = document.createElement('textarea');
    chatInput.id = 'llm-chat-input';
    chatInput.placeholder = '在此输入题目或内容... (Shift+Enter 换行)';

    const buttonGroup = document.createElement('div');
    buttonGroup.id = 'llm-button-group';

    const sendButton = document.createElement('button');
    sendButton.id = 'llm-send-button';
    sendButton.textContent = '发送';

    const fetchButton = document.createElement('button');
    fetchButton.id = 'llm-fetch-button';
    fetchButton.textContent = '获取页面内容';
    fetchButton.title = '提取当前页面的文本内容到输入框';

    const clearButton = document.createElement('button');
    clearButton.id = 'llm-clear-button';
    clearButton.textContent = '清空对话';

    // 组装 UI
    buttonGroup.appendChild(fetchButton);
    buttonGroup.appendChild(clearButton);
    buttonGroup.appendChild(sendButton);
    inputArea.appendChild(chatInput);
    inputArea.appendChild(buttonGroup);
    chatContainer.appendChild(chatHistoryDiv);
    chatContainer.appendChild(inputArea);
    sidebar.appendChild(chatContainer);
    document.body.appendChild(sidebar);

    // --- 添加样式 ---
    GM_addStyle(`
        /* Styles remain the same */
        #llm-sidebar {
            position: fixed; top: 0; right: 0; width: 350px; height: 100%;
            background-color: #f8f9fa; border-left: 1px solid #dee2e6;
            box-shadow: -2px 0 8px rgba(0,0,0,0.1); z-index: 99998;
            transform: translateX(100%); transition: transform 0.3s ease-in-out;
            display: flex; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
        }
        #llm-floating-toggle {
            position: fixed; width: ${FLOATING_BUTTON_SIZE}px; height: ${FLOATING_BUTTON_SIZE}px;
            background-color: #007bff; color: white; border-radius: 50%;
            cursor: grab; z-index: 99999; display: flex; justify-content: center; align-items: center;
            font-size: ${FLOATING_BUTTON_SIZE * 0.5}px; box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            transition: left 0.3s ease-out, top 0.1s linear, background-color 0.2s; user-select: none;
        }
        #llm-floating-toggle:hover { background-color: #0056b3; }
        #llm-floating-toggle:active { cursor: grabbing; box-shadow: 0 2px 4px rgba(0,0,0,0.3); }
        #llm-chat-container { width: 100%; height: 100%; display: flex; flex-direction: column; padding: 15px; box-sizing: border-box; }
        #llm-chat-history { flex-grow: 1; overflow-y: auto; background-color: #ffffff; border: 1px solid #e9ecef; margin-bottom: 15px; padding: 12px; border-radius: 8px; scroll-behavior: smooth; }
        #llm-chat-history::-webkit-scrollbar { width: 6px; }
        #llm-chat-history::-webkit-scrollbar-track { background: #f1f1f1; border-radius: 3px; }
        #llm-chat-history::-webkit-scrollbar-thumb { background: #ccc; border-radius: 3px; }
        #llm-chat-history::-webkit-scrollbar-thumb:hover { background: #aaa; }
        .llm-chat-message { margin-bottom: 12px; padding: 10px 15px; border-radius: 12px; max-width: 90%; word-wrap: break-word; line-height: 1.5; font-size: 14px; }
        .llm-chat-message.user { background-color: #cfe2ff; color: #052c65; align-self: flex-end; margin-left: auto; }
        .llm-chat-message.llm { background-color: #e9ecef; color: #343a40; align-self: flex-start; margin-right: auto; white-space: pre-wrap; }
        .llm-chat-message pre { background-color: #212529; color: #f8f9fa; padding: 12px; border-radius: 6px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; font-family: "Courier New", Courier, monospace; font-size: 13px; margin-top: 8px; margin-bottom: 5px; position: relative; }
        .llm-chat-message code:not(pre code) { background-color: rgba(0, 0, 0, 0.05); padding: 2px 4px; border-radius: 3px; font-family: "Courier New", Courier, monospace; }
        .llm-chat-message pre button { position: absolute; top: 5px; right: 5px; padding: 3px 6px; font-size: 12px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; opacity: 0.7; transition: opacity 0.2s; }
        .llm-chat-message pre button:hover { opacity: 1; }
        #llm-input-area { display: flex; flex-direction: column; height: auto; }
        #llm-chat-input { width: 100%; min-height: 60px; max-height: 200px; height: auto; padding: 10px; border: 1px solid #ced4da; border-radius: 8px; margin-bottom: 10px; resize: vertical; box-sizing: border-box; font-family: inherit; font-size: 14px; line-height: 1.4; }
        #llm-chat-input:focus { border-color: #86b7fe; outline: 0; box-shadow: 0 0 0 0.25rem rgba(13, 110, 253, 0.25); }
        #llm-button-group { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
        #llm-button-group button { padding: 10px 15px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 500; transition: background-color 0.2s, box-shadow 0.2s; }
        #llm-button-group button:hover { opacity: 0.9; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        #llm-button-group button:active { box-shadow: inset 0 1px 2px rgba(0,0,0,0.1); }
        #llm-send-button { background-color: #198754; color: white; flex-grow: 1; }
        #llm-send-button:hover { background-color: #157347; }
        #llm-fetch-button { background-color: #ffca2c; color: #333; }
        #llm-fetch-button:hover { background-color: #ffc107; }
        #llm-clear-button { background-color: #dc3545; color: white; }
        #llm-clear-button:hover { background-color: #bb2d3b; }
        .llm-loading { text-align: center; padding: 10px; color: #6c757d; font-style: italic; }
        .llm-error-message { color: #dc3545; font-weight: bold; }
    `);

    // --- 功能实现 ---

    function setFloatingButtonPosition(pos) {
        const buttonWidth = FLOATING_BUTTON_SIZE; const buttonHeight = FLOATING_BUTTON_SIZE;
        let targetLeft; const maxTop = window.innerHeight - buttonHeight;
        const clampedTop = Math.max(0, Math.min(pos.top, maxTop));
        targetLeft = (pos.side === 'left') ? 0 : window.innerWidth - buttonWidth;
        floatingButton.style.top = `${clampedTop}px`; floatingButton.style.left = `${targetLeft}px`;
        floatingButtonPos = { side: pos.side, top: clampedTop }; GM_setValue('floatingButtonPos', floatingButtonPos);
    }

    floatingButton.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return; isDragging = true; hasDragged = false;
        dragStartX = e.clientX; dragStartY = e.clientY;
        elementStartX = floatingButton.offsetLeft; elementStartY = floatingButton.offsetTop;
        floatingButton.style.transition = 'none'; floatingButton.style.cursor = 'grabbing';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const currentX = e.clientX; const currentY = e.clientY;
        const deltaX = currentX - dragStartX; const deltaY = currentY - dragStartY;
        if (!hasDragged && (Math.abs(deltaX) > clickDetectionThreshold || Math.abs(deltaY) > clickDetectionThreshold)) { hasDragged = true; }
        let newLeft = elementStartX + deltaX; let newTop = elementStartY + deltaY;
        const maxLeft = window.innerWidth - FLOATING_BUTTON_SIZE; const maxTop = window.innerHeight - FLOATING_BUTTON_SIZE;
        newLeft = Math.max(0, Math.min(newLeft, maxLeft)); newTop = Math.max(0, Math.min(newTop, maxTop));
        floatingButton.style.left = `${newLeft}px`; floatingButton.style.top = `${newTop}px`;
    });

    document.addEventListener('mouseup', (e) => {
        if (!isDragging) return; if (e.button !== 0) return; isDragging = false;
        floatingButton.style.cursor = 'grab'; floatingButton.style.transition = 'left 0.3s ease-out, top 0.1s linear, background-color 0.2s';
        const currentLeft = floatingButton.offsetLeft; const buttonWidth = floatingButton.offsetWidth;
        const windowWidth = window.innerWidth; const distanceToLeft = currentLeft;
        const distanceToRight = windowWidth - (currentLeft + buttonWidth);
        let finalSide = (distanceToLeft < distanceToRight) ? 'left' : 'right';
        setFloatingButtonPosition({ side: finalSide, top: floatingButton.offsetTop });
    });

    floatingButton.addEventListener('click', (e) => {
        if (hasDragged) { return; } sidebarOpen = !sidebarOpen;
        sidebar.style.transform = sidebarOpen ? 'translateX(0)' : 'translateX(100%)';
        GM_setValue('sidebarOpen', sidebarOpen);
        if (sidebarOpen) { chatInput.focus(); scrollToBottom(); }
    });

    window.addEventListener('resize', () => {
        setTimeout(() => { if (!isDragging) { setFloatingButtonPosition(floatingButtonPos); } }, 100);
    });

    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });

    fetchButton.addEventListener('click', () => {
        try {
            let content = '';
            const selectors = ['main', 'article', '#main', '#content', '.main', '.content', '#primary', '.post-content', '.entry-content'];
            let mainElement = null;
            for (const selector of selectors) { mainElement = document.querySelector(selector); if (mainElement) break; }
            if (mainElement) {
                const clone = mainElement.cloneNode(true);
                clone.querySelectorAll('script, style, nav, header, footer, aside, form, button, input, select, textarea, .noprint, .advertisement').forEach(el => el.remove());
                content = clone.innerText;
            } else {
                const bodyClone = document.body.cloneNode(true);
                bodyClone.querySelectorAll('script, style, nav, header, footer, aside, form, button, input, select, textarea, #llm-sidebar, #llm-floating-toggle, .noprint, .advertisement').forEach(el => el.remove());
                content = bodyClone.innerText;
            }
            content = content.replace(/<[^>]+>/g, ' ').replace(/\s\s+/g, ' ').trim();
            if (content) {
                chatInput.value = content; chatInput.style.height = 'auto';
                chatInput.style.height = chatInput.scrollHeight + 'px'; chatInput.focus();
                chatInput.scrollTop = chatInput.scrollHeight;
            } else { alert('未能获取到页面主要内容。'); }
        } catch (error) {
            console.error('获取页面内容时出错:', error); alert('获取页面内容时发生错误，请查看浏览器控制台获取详情。');
            chatInput.value = `获取页面内容失败: ${error.message}`;
        }
    });

    clearButton.addEventListener('click', () => {
        if (confirm('确定要清空所有对话记录吗？此操作不可撤销。')) {
            chatHistory = []; GM_setValue('chatHistory', JSON.stringify(chatHistory)); renderChatHistory();
        }
    });

    function renderChatHistory() {
        chatHistoryDiv.innerHTML = '';
        chatHistory.forEach(msg => { appendMessage(msg.sender, msg.text, false, msg); });
        scrollToBottom();
    }

    function appendMessage(sender, text, isLoading = false, messageData = null) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('llm-chat-message', sender);

        if (isLoading) {
            messageDiv.classList.add('llm-loading');
            messageDiv.textContent = 'AI 正在思考...';
        } else if (messageData && messageData.isError) {
            messageDiv.classList.add('llm-error-message');
            messageDiv.textContent = text;
        } else {
            const escapedText = text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
            let processedText = escapedText.replace(/```(\w*?)\n([\s\S]*?)```/g, (match, lang, code) => {
                const decodedCode = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                const codeBlock = document.createElement('pre'); const codeElement = document.createElement('code');
                if (lang) { codeElement.className = `language-${lang}`; } codeElement.textContent = decodedCode.trim();
                codeBlock.appendChild(codeElement); return codeBlock.outerHTML;
            });
            processedText = processedText.replace(/`([^`]+?)`/g, (match, code) => {
                const inlineCode = document.createElement('code'); inlineCode.textContent = code.replace(/&lt;/g, '<').replace(/&gt;/g, '>');
                return inlineCode.outerHTML;
            });
            processedText = processedText.replace(/\n/g, '<br>');
            messageDiv.innerHTML = processedText;

            if (sender === 'llm' && messageDiv.querySelector('pre')) {
                messageDiv.querySelectorAll('pre').forEach(pre => {
                    if (pre.querySelector('button.copy-code-button')) return;
                    const copyButton = document.createElement('button'); copyButton.textContent = '复制'; copyButton.className = 'copy-code-button';
                    copyButton.style.cssText = 'position: absolute; top: 5px; right: 5px; padding: 3px 6px; font-size: 12px; background-color: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; opacity: 0.7;';
                    copyButton.onmouseover = () => copyButton.style.opacity = '1'; copyButton.onmouseout = () => copyButton.style.opacity = '0.7';
                    copyButton.onclick = (e) => {
                        e.stopPropagation(); const codeToCopy = pre.querySelector('code').textContent;
                        navigator.clipboard.writeText(codeToCopy).then(() => { copyButton.textContent = '已复制!'; setTimeout(() => copyButton.textContent = '复制', 2000); })
                        .catch(err => { console.error('无法复制到剪贴板:', err); copyButton.textContent = '失败'; setTimeout(() => copyButton.textContent = '复制', 2000); });
                    };
                    pre.style.position = 'relative'; pre.appendChild(copyButton);
                });
            }
        }
        const loadingIndicator = chatHistoryDiv.querySelector('.llm-loading');
        if (loadingIndicator) { chatHistoryDiv.insertBefore(messageDiv, loadingIndicator); }
        else { chatHistoryDiv.appendChild(messageDiv); }
        const isScrolledToBottom = chatHistoryDiv.scrollHeight - chatHistoryDiv.clientHeight <= chatHistoryDiv.scrollTop + 10;
        if (isScrolledToBottom) { scrollToBottom(); }
        return messageDiv;
    }

    function scrollToBottom() { requestAnimationFrame(() => { chatHistoryDiv.scrollTop = chatHistoryDiv.scrollHeight; }); }

    // --- sendMessage Function (Simplified - No Streaming) ---
    function sendMessage() {
        const messageText = chatInput.value.trim(); if (!messageText) return;
        const userMessageData = { sender: 'user', text: messageText };
        appendMessage(userMessageData.sender, userMessageData.text, false, userMessageData);
        chatHistory.push(userMessageData);
        chatInput.value = ''; chatInput.style.height = 'auto'; chatInput.style.height = '60px';
        const messagesToSend = chatHistory.map(msg => ({ role: msg.sender === 'user' ? 'user' : 'assistant', content: msg.text }));
        if (DEFAULT_SYSTEM_PROMPT) { messagesToSend.unshift({ role: 'system', content: DEFAULT_SYSTEM_PROMPT }); }

        if (!LLM_API_ENDPOINT || LLM_API_ENDPOINT === 'YOUR_LLM_API_ENDPOINT') { appendMessage('llm', '错误：LLM_API_ENDPOINT 未正确配置', true, {isError: true}); return; }
        if (!API_KEY || API_KEY === 'YOUR_API_KEY') { appendMessage('llm', '错误：API_KEY 未正确配置 (如果需要)', true, {isError: true}); return; }

        const loadingMessageDiv = appendMessage('llm', '', true);

        const requestData = { messages: messagesToSend, model: MODEL_NAME, temperature: TEMPERATURE, max_tokens: MAX_TOKENS, top_p: TOP_P, stream: false };
        console.log('--- Sending Request Data ---'); console.log(JSON.stringify(requestData, null, 2));

        GM_xmlhttpRequest({
            method: 'POST', url: LLM_API_ENDPOINT,
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
            data: JSON.stringify(requestData),
            responseType: 'json',
            timeout: 60000,

            onload: function(response) {
                if (loadingMessageDiv && loadingMessageDiv.parentNode === chatHistoryDiv) {
                    chatHistoryDiv.removeChild(loadingMessageDiv);
                }
                console.log('--- Received Response (onload) ---'); console.log('Status:', response.status);
                console.log('Raw Response Text:', response.responseText); console.log('Parsed Response JSON:', response.response);

                let finalLlmResponseText = ''; let isError = false; let errorText = '';
                try {
                    if (response.status >= 200 && response.status < 300) {
                        const responseData = response.response;
                        finalLlmResponseText = responseData.choices?.[0]?.message?.content?.trim();
                        if (!finalLlmResponseText) {
                             isError = true; console.error('LLM API Error: Unexpected JSON structure', responseData);
                             errorText = `API 响应格式错误: ${JSON.stringify(responseData)}`;
                        }
                    } else {
                        isError = true; console.error('LLM API Error:', response.status, response.statusText, response.response);
                        let errorDetail = JSON.stringify(response.response || response.responseText);
                         if (response.response) {
                             if (response.response.error?.message) { errorDetail = response.response.error.message; }
                             else if (response.response.detail) { errorDetail = response.response.detail; }
                             else if (response.response.message) { errorDetail = response.response.message; }
                         }
                        errorText = `API 请求失败: ${response.status} ${response.statusText}\n错误详情: ${errorDetail}`;
                    }
                } catch (error) {
                     isError = true; console.error('处理 API 响应时出错:', error);
                     errorText = `处理 API 响应时出错: ${error.message}\n原始响应: ${response.responseText}`;
                } finally {
                    if (isError) {
                        const errorMsgData = { sender: 'llm', text: errorText, isError: true };
                        appendMessage(errorMsgData.sender, errorMsgData.text, false, errorMsgData);
                        chatHistory.push(errorMsgData);
                    } else if (finalLlmResponseText) {
                        const llmMessageData = { sender: 'llm', text: finalLlmResponseText };
                        appendMessage(llmMessageData.sender, llmMessageData.text, false, llmMessageData);
                        if (chatHistory.length === 0 || chatHistory[chatHistory.length - 1].text !== llmMessageData.text || chatHistory[chatHistory.length - 1].sender !== 'llm') {
                            chatHistory.push(llmMessageData);
                        }
                    }
                    GM_setValue('chatHistory', JSON.stringify(chatHistory)); scrollToBottom();
                }
            },
            onerror: function(response) {
                 if (loadingMessageDiv && loadingMessageDiv.parentNode === chatHistoryDiv) { chatHistoryDiv.removeChild(loadingMessageDiv); }
                console.error('GM_xmlhttpRequest Network Error:', response);
                const networkErrorText = `网络请求错误: ${response.statusText || '无法连接到服务器'}`;
                const errorMsgData = { sender: 'llm', text: networkErrorText, isError: true };
                appendMessage(errorMsgData.sender, errorMsgData.text, false, errorMsgData);
                chatHistory.push(errorMsgData); GM_setValue('chatHistory', JSON.stringify(chatHistory)); scrollToBottom();
            },
             ontimeout: function() {
                  if (loadingMessageDiv && loadingMessageDiv.parentNode === chatHistoryDiv) { chatHistoryDiv.removeChild(loadingMessageDiv); }
                 console.error('GM_xmlhttpRequest Timeout Error');
                 const timeoutErrorText = '请求超时：服务器未在规定时间内响应。';
                 const errorMsgData = { sender: 'llm', text: timeoutErrorText, isError: true };
                 appendMessage(errorMsgData.sender, errorMsgData.text, false, errorMsgData);
                 chatHistory.push(errorMsgData); GM_setValue('chatHistory', JSON.stringify(chatHistory)); scrollToBottom();
            }
        });
    }

    // --- 初始化 ---
    renderChatHistory();
    setFloatingButtonPosition(floatingButtonPos);
    sidebar.style.display = 'flex';
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto'; chatInput.style.height = (chatInput.scrollHeight) + 'px';
    });

})();
