(function () {
	const STYLE_ID = 'autolr-style';
	const APPLY_FLAG = 'autoLrApplied';
	const FONT_STACK = '"Hiragino Kaku Gothic Pro", "Noto Sans JP", sans-serif';
	const EPISODE_PATTERN = /第[^\r\n]*?話/;

	let waitingObserver = null;

	function ensureViewport() {
		if (document.querySelector('meta[name="viewport"]')) return;

		const meta = document.createElement('meta');
		meta.name = 'viewport';
		meta.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
		document.head.appendChild(meta);
	}

	function ensureStyles() {
		if (document.getElementById(STYLE_ID)) return;

		const style = document.createElement('style');
		style.id = STYLE_ID;
		style.textContent = [
			'html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }',
			'body { margin: 0; padding: 0 10px 32px; color: #222; font-family: ' + FONT_STACK + '; background: #fff; }',
			'body, body * { box-sizing: border-box; font-family: inherit; }',
			'#auto-lr-content { max-width: 960px; margin: 0 auto; padding-top: 12px; line-height: 1.9; white-space: pre-wrap; }',
			'#auto-lr-content h1 { margin: 0 0 1em; font-size: clamp(1.7rem, 4vw, 2.6rem); line-height: 1.25; }',
			'#auto-lr-content h3 { margin: 1.1em 0 0.5em; font-size: 1.2rem; line-height: 1.35; }',
			'#auto-lr-content p, #auto-lr-content div, #auto-lr-content span { margin: 0; }',
			'#auto-lr-content a { color: inherit; text-decoration: none; }',
			'#auto-lr-content a:hover h3 { text-decoration: underline; }',
			'#auto-lr-content br { line-height: 1; }'
		].join('\n');
		document.head.appendChild(style);
	}

	function getBodyText() {
		const body = document.body;
		if (!body) return '';

		const nodes = Array.from(body.childNodes);
		const textParts = [];

		for (const node of nodes) {
			if (node.nodeType === Node.TEXT_NODE) {
				textParts.push(node.textContent || '');
			}
		}

		if (textParts.length > 0) {
			const directText = textParts.join('');
			if (directText.trim()) {
				return directText;
			}
		}

		return body.innerText || body.textContent || '';
	}

	function makeLineNode(line, isFirstLine) {
		const trimmed = line.trim();
		if (!trimmed) {
			return document.createElement('br');
		}

		if (isFirstLine) {
			const h1 = document.createElement('h1');
			h1.textContent = line;
			return h1;
		}

		const episodeMatch = line.match(EPISODE_PATTERN);
		if (episodeMatch) {
			const episodeId = episodeMatch[0];
			const anchor = document.createElement('a');
			anchor.href = '#' + episodeId;

			const h3 = document.createElement('h3');
			h3.id = episodeId;
			h3.textContent = line;

			anchor.appendChild(h3);
			return anchor;
		}

		const block = document.createElement('div');
		block.textContent = line;
		return block;
	}

	function collectMixedContent(root) {
		const container = document.createElement('main');
		container.id = 'auto-lr-content';

		let textBuffer = '';
		let seenFirstLine = false;

		function flushTextBuffer() {
			if (!textBuffer) return;

			const normalized = textBuffer.replace(/\r\n?/g, '\n');
			const lines = normalized.split('\n');
			for (const line of lines) {
				const isFirstContentLine = !seenFirstLine && line.trim();
				const node = makeLineNode(line, Boolean(isFirstContentLine));
				if (line.trim() && !seenFirstLine) {
					seenFirstLine = true;
				}
				container.appendChild(node);
			}

			textBuffer = '';
		}

		const childNodes = Array.from(root.childNodes);
		for (const node of childNodes) {
			if (node.nodeType === Node.TEXT_NODE) {
				textBuffer += node.textContent || '';
				continue;
			}

			if (node.nodeType === Node.ELEMENT_NODE) {
				const tagName = node.tagName;
				if (tagName === 'SCRIPT' || tagName === 'STYLE' || tagName === 'NOSCRIPT') {
					continue;
				}

				flushTextBuffer();
				container.appendChild(node);
			}
		}

		flushTextBuffer();
		return container;
	}

	function applyAutoLr() {
		const body = document.body;
		if (!body) return;

		if (body.dataset[APPLY_FLAG] === '1') return;

		ensureViewport();
		ensureStyles();

		const sourceText = getBodyText();
		if (!sourceText.trim()) return;

		const rendered = collectMixedContent(body);
		body.replaceChildren(rendered);
		body.dataset[APPLY_FLAG] = '1';
	}

	function boot() {
		if (document.getElementById('encrypted-content')) {
			if (waitingObserver) return;

			waitingObserver = new MutationObserver(() => {
				if (!document.getElementById('encrypted-content')) {
					waitingObserver.disconnect();
					waitingObserver = null;
					applyAutoLr();
				}
			});
			waitingObserver.observe(document.body, { childList: true, subtree: true });
			return;
		}

		applyAutoLr();
	}

	window.autoLRApply = function () {
		if (document.getElementById('encrypted-content')) {
			boot();
			return;
		}

		applyAutoLr();
	};

	window.autoLrApply = window.autoLRApply;

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', boot, { once: true });
	} else {
		boot();
	}
})();
