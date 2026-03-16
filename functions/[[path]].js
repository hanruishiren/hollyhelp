// functions/[[path]].js

export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);

    // 1. 解析目标网址
    // 用户访问格式: https://your-project.pages.dev/https://target.com/path?query=1
    // url.pathname 会是 "/https://target.com/path"
    // 我们去掉第一个斜杠即可得到目标地址
    const targetURL = url.pathname.substring(1) + url.search;

    // 校验 URL 是否合法
    if (!targetURL.startsWith('http://') && !targetURL.startsWith('https://')) {
        return new Response(
            'Usage: https://your-project.pages.dev/https://target.com\n' +
            'Error: Invalid URL. Must start with http:// or https://',
            { status: 400, headers: { 'Content-Type': 'text/plain' } }
        );
    }

    // 2. 处理 CORS 预检请求
    // 浏览器在发送复杂请求前会先发送 OPTIONS 请求
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
                'Access-Control-Allow-Headers': '*', // 允许所有头部，或者按需修改
                'Access-Control-Max-Age': '86400',
            },
        });
    }

    // 3. 构造转发的请求
    // 复制原始请求的大部分头部，但移除 Cloudflare 特有的和可能干扰转发的头部
    const newHeaders = new Headers(request.headers);
    newHeaders.delete('Host'); // 必须删除，否则目标服务器会拒绝
    // 删除 CF 特有的头部，防止暴露源站信息或导致目标服务器拒绝
    const cfHeaders = ['cf-connecting-ip', 'cf-ipcountry', 'cf-ray', 'cf-visitor', 'x-forwarded-proto'];
    cfHeaders.forEach(h => newHeaders.delete(h));

    // 如果有 Referer，可以保留；如果目标站检查 Referer 严格，这里可能需要修改
    // newHeaders.set('Referer', targetURL); 

    const modifiedRequest = new Request(targetURL, {
        method: request.method,
        headers: newHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : null,
        redirect: 'follow', // 自动跟随重定向
    });

    try {
        // 4. 发起请求
        const response = await fetch(modifiedRequest);

        // 5. 处理响应，添加 CORS 头
        // 注意：Headers 对象是可变的，我们需要复制一个新的响应以便修改头部
        const modifiedResponse = new Response(response.body, response);

        // 添加 CORS 头部
        modifiedResponse.headers.set('Access-Control-Allow-Origin', '*');
        modifiedResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        
        // 这一步很重要：很多文件服务器（如 AWS S3, 又拍云等）会压缩响应
        // 如果我们直接透传 Content-Encoding，浏览器可能会收到双重压缩导致无法解码
        // 所以通常建议删除 Content-Encoding，让浏览器接收原始数据，或者让 CF 重新压缩
        modifiedResponse.headers.delete('Content-Encoding');
        
        return modifiedResponse;

    } catch (e) {
        return new Response('Proxy Error: ' + e.message, { status: 500 });
    }
}