import turndownPluginGfm from '@guyplusplus/turndown-plugin-gfm';
import turndown from 'turndown';
import path from 'path';
import fs from 'fs';
import * as shared from './shared.js';

// init single reusable turndown service object upon import
const turndownService = initTurndownService();

function initTurndownService() {
	const turndownService = new turndown({
		headingStyle: 'atx',
		bulletListMarker: '-',
		codeBlockStyle: 'fenced'
	});

	turndownService.use(turndownPluginGfm.tables);

	turndownService.remove(['style']); // <style> contents get dumped as plain text, would rather remove
	
	// In my Obsidian Vault, underscores from em tag conversion are seen as image captions, 
	// so I leave them. Comment out or delete if not needed.
	turndownService.addRule('em', {
		filter: 'em',
		replacement: (content) => content
	});

	// preserve embedded tweets
	turndownService.addRule('tweet', {
		filter: (node) => node.nodeName === 'BLOCKQUOTE' && node.getAttribute('class') === 'twitter-tweet',
		replacement: (content, node) => '\n\n' + node.outerHTML
	});

	// preserve embedded codepens
	turndownService.addRule('codepen', {
		filter: (node) => {
			// codepen embed snippets have changed over the years
			// but this series of checks should find the commonalities
			return (
				['P', 'DIV'].includes(node.nodeName) &&
				node.attributes['data-slug-hash'] &&
				node.getAttribute('class') === 'codepen'
			);
		},
		replacement: (content, node) => '\n\n' + node.outerHTML
	});

	// <div> within <a> can cause extra whitespace that wreck markdown links, so this removes them
	turndownService.addRule('div', {
		filter: (node) => {
			return node.nodeName === 'DIV' && node.closest('a') !== null;
		},
		replacement: (content) => content
	});

	// preserve embedded scripts (for tweets, codepens, gists, etc.)
	turndownService.addRule('script', {
		filter: 'script',
		replacement: (content, node) => {
			let before = '\n\n';
			if (node.previousSibling && node.previousSibling.nodeName !== '#text') {
				// keep twitter and codepen <script> tags snug with the element above them
				before = '\n';
			}
			const html = node.outerHTML.replace('async=""', 'async');
			return before + html + '\n\n';
		}
	});

	// iframe boolean attributes do not need to be set to empty string
	turndownService.addRule('iframe', {
		filter: 'iframe',
		replacement: (content, node) => {
			const html = node.outerHTML
				.replace('allowfullscreen=""', 'allowfullscreen')
				.replace('allowpaymentrequest=""', 'allowpaymentrequest');
			return '\n\n' + html + '\n\n';
		}
	});

	// Obsidian形式の画像処理
	turndownService.addRule('figure', {
		filter: 'figure',
		replacement: (content, node) => {
			const img = node.querySelector('img');
			const figcaption = node.querySelector('figcaption');
			
			if (!img) return content;
			
			const imgSrc = img.getAttribute('src');
			const imgName = path.basename(imgSrc);
			const obsidianImage = `![[${imgName}|caption]]`;
			
			if (figcaption) {
				const captionText = figcaption.textContent.trim();
				return `\n\n${obsidianImage}\n*${captionText}*\n\n`;
			}
			
			return `\n\n${obsidianImage}\n\n`;
		}
	});

	// convert <pre> into a code block with language when appropriate
	turndownService.addRule('pre', {
		filter: (node) => {
			// a <pre> with <code> inside will already render nicely, so don't interfere
			return node.nodeName === 'PRE' && !node.querySelector('code');
		},
		replacement: (content, node) => {
			const language = node.getAttribute('data-wetm-language') ?? '';
			return '\n\n```' + language + '\n' + node.textContent + '\n```\n\n';
		}
	});

	// (Only if using the SWELL theme) Rules for removing STEP labels
    turndownService.addRule('stepLabel', {
        filter: (node) => {
            return node.nodeName === 'DIV' && 
                   node.classList.contains('swell-block-step__number') &&
                   node.querySelector('span.__label');
        },
        replacement: () => '' // Remove STEP label by returning an empty string
    });

	// footnote
	turndownService.addRule('footnote', {
		filter: (node) => {
			return node.nodeName === 'SUP' && node.hasAttribute('data-fn');
		},
		replacement: (content, node) => {
			// get the text of the a tag
			const linkText = node.querySelector('a')?.textContent;
			return `[^${linkText}]`;
		}
	});

	return turndownService;
}

export function getPostContent(content) {
	// insert an empty div element between double line breaks
	// this nifty trick causes turndown to keep adjacent paragraphs separated
	// without mucking up content inside of other elements (like <code> blocks)
	content = content.replace(/(\r?\n){2}/g, '\n<div></div>\n');

	if (shared.config.saveImages === 'scraped' || shared.config.saveImages === 'all') {
		// writeImageFile() will save all content images to a relative /images
		// folder so update references in post content to match
		content = content.replace(/(<img(?=\s)[^>]+?(?<=\s)src=")[^"]*?([^/"]+?)(\?[^"]*)?("[^>]*>)/gi, '$1images/$2$4');
	}

	// Conversion of HTML enclosed in [html] tags
    content = content.replace(/\[html\](&lt;|\<)(h[1-6])(&gt;|\>)(.+?)\1(\/\2)\3\[\/html\]/g, '<$2>$4</$2>');

	// preserve "more" separator, max one per post, optionally with custom label
	// by escaping angle brackets (will be unescaped during turndown conversion)
	content = content.replace(/<(!--more( .*)?--)>/, '&lt;$1&gt;');

	// some WordPress plugins specify a code language in an HTML comment above a
	// <pre> block, save it to a data attribute so the "pre" rule can use it
	content = content.replace(/(<!-- wp:.+? \{"language":"(.+?)"\} -->\r?\n<pre )/g, '$1data-wetm-language="$2" ');

	// use turndown to convert HTML to Markdown
	content = turndownService.turndown(content);

	// clean up extra spaces in list items
	content = content.replace(/(-|\d+\.) +/g, '$1 ');

	// collapse excessive newlines (can happen with a lot of <div>)
	content = content.replace(/(\r?\n){3,}/g, '\n\n');

	return content;
}
