export const {
	util: { BareClient, ScramjetHeaders },
	url: { encodeUrl, decodeUrl },
	rewrite: {
		rewriteCss,
		rewriteHtml,
		unrewriteHtml,
		rewriteSrcset,
		rewriteJs,
		rewriteHeaders,
		rewriteWorkers,
		htmlRules,
	},
	CookieStore,
} = self.$scramjet.shared;

export const config = self.$scramjet.config;