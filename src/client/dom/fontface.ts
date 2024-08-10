import { ScramjetClient } from "../client";
import { decodeUrl, rewriteCss } from "../shared";

export default function (client: ScramjetClient, self: typeof window) {
	client.Proxy("FontFace", {
		construct(ctx) {
			dbg.log("FontFace", ctx.args);
			ctx.args[1] = rewriteCss(ctx.args[1]);
		},
	});
}