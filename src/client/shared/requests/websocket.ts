import { iswindow, isworker } from "../..";
import { ScramjetClient } from "../../client";
import { BareClient } from "../../../shared";

const bare = iswindow && new BareClient();

export default function (client: ScramjetClient, self: typeof globalThis) {
	// r58 please fix
	if (isworker) return;

	client.Proxy("WebSocket", {
		construct(ctx) {
			ctx.return(
				bare.createWebSocket(
					ctx.args[0],
					ctx.args[1],
					ctx.fn as typeof WebSocket,
					{
						"User-Agent": self.navigator.userAgent,
						Origin: client.url.origin,
					},
					ArrayBuffer.prototype
				)
			);
		},
	});
}
