import { BareClient } from "@mercuryworkshop/bare-mux";
import { BareResponseFetch } from "@mercuryworkshop/bare-mux";
import { encodeUrl, decodeUrl, rewriteCss, rewriteHeaders, rewriteHtml, rewriteJs } from "../shared";

declare global {
    interface Window {
        ScramjetServiceWorker;
    }
}

export default class ScramjetServiceWorker {
    client: typeof BareClient.prototype;
    config: typeof self.__scramjet$config;
    constructor(config = self.__scramjet$config) {
        this.client = new BareClient();
        if (!config.prefix) config.prefix = "/scramjet/";
        this.config = config;
    }

    route({ request }: FetchEvent) {
        if (request.url.startsWith(location.origin + this.config.prefix)) return true;
        else return false;
    }

    async fetch({ request }: FetchEvent) {
        const urlParam = new URLSearchParams(new URL(request.url).search);

        if (urlParam.has("url")) {
            return Response.redirect(encodeUrl(urlParam.get("url"), new URL(urlParam.get("url"))))
        }

        try {
            const url = new URL(decodeUrl(request.url));

            const response: BareResponseFetch = await this.client.fetch(url, {
                method: request.method,
                body: request.body,
                headers: request.headers,
                credentials: "omit",
                mode: request.mode === "cors" ? request.mode : "same-origin",
                cache: request.cache,
                redirect: request.redirect,
            });

            let responseBody;
            const responseHeaders = rewriteHeaders(response.rawHeaders, url);
            if (response.body) {
                switch (request.destination) {
                case "iframe":
                case "document":
                    responseBody = rewriteHtml(await response.text(), url);
                    break;
                case "script":
                    responseBody = rewriteJs(await response.text(), url);
                    break;
                case "style":
                    responseBody = rewriteCss(await response.text(), url);
                    break;
                case "sharedworker":
                case "worker":
                    break;
                default:
                    responseBody = response.body;
                    break;
                }
            }
            // downloads
            if (["document", "iframe"].includes(request.destination)) {
                const header = responseHeaders["content-disposition"];

                // validate header and test for filename
                if (!/\s*?((inline|attachment);\s*?)filename=/i.test(header)) {
                    // if filename= wasn"t specified then maybe the remote specified to download this as an attachment?
                    // if it"s invalid then we can still possibly test for the attachment/inline type
                    const type = /^\s*?attachment/i.test(header)
                        ? "attachment"
                        : "inline";

                    // set the filename
                    const [filename] = new URL(response.finalURL).pathname
                        .split("/")
                        .slice(-1);

                    responseHeaders[
                        "content-disposition"
                    ] = `${type}; filename=${JSON.stringify(filename)}`;
                }
            }
            if (responseHeaders["accept"] === "text/event-stream") {
                responseHeaders["content-type"] = "text/event-stream";
            }
            if (crossOriginIsolated) {
                responseHeaders["Cross-Origin-Embedder-Policy"] = "require-corp";
            }

            return new Response(responseBody, {
                headers: responseHeaders as HeadersInit,
                status: response.status,
                statusText: response.statusText
            })
        } catch (err) {
            if (!["document", "iframe"].includes(request.destination))
                return new Response(undefined, { status: 500 });
            
            console.error(err);

            return renderError(err, decodeUrl(request.url));
        }
    }
}


function errorTemplate(
    trace: string,
    fetchedURL: string,
) {
    // turn script into a data URI so we don"t have to escape any HTML values
    const script = `
        errorTrace.value = ${JSON.stringify(trace)};
        fetchedURL.textContent = ${JSON.stringify(fetchedURL)};
        for (const node of document.querySelectorAll("#hostname")) node.textContent = ${JSON.stringify(
        location.hostname
    )};
        reload.addEventListener("click", () => location.reload());
        version.textContent = "0.0.1";
    `

    return (
        `<!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8" />
        <title>Error</title>
        <style>
        * { background-color: white }
        </style>
        </head>
        <body>
        <h1 id="errorTitle">Error processing your request</h1>
        <hr />
        <p>Failed to load <b id="fetchedURL"></b></p>
        <p id="errorMessage">Internal Server Error</p>
        <textarea id="errorTrace" cols="40" rows="10" readonly></textarea>
        <p>Try:</p>
        <ul>
        <li>Checking your internet connection</li>
        <li>Verifying you entered the correct address</li>
        <li>Clearing the site data</li>
        <li>Contacting <b id="hostname"></b>"s administrator</li>
        <li>Verify the server isn"t censored</li>
        </ul>
        <p>If you"re the administrator of <b id="hostname"></b>, try:</p>
        <ul>
        <li>Restarting your server</li>
        <li>Updating Scramjet</li>
        <li>Troubleshooting the error on the <a href="https://github.com/MercuryWorkshop/scramjet" target="_blank">GitHub repository</a></li>
        </ul>
        <button id="reload">Reload</button>
        <hr />
        <p><i>Scramjet v<span id="version"></span></i></p>
        <script src="${
        "data:application/javascript," + encodeURIComponent(script)
        }"></script>
        </body>
        </html>
        `
    );
}

/**
 *
 * @param {unknown} err
 * @param {string} fetchedURL
 */
function renderError(err, fetchedURL) {
    const headers = {
        "content-type": "text/html",
    };
    if (crossOriginIsolated) {
        headers["Cross-Origin-Embedd'er-Policy"] = "require-corp";
    }

    return new Response(
        errorTemplate(
            String(err),
            fetchedURL
        ),
        {
            status: 500,
            headers: headers
        }
    );
}

