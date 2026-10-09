import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return handleRequest(req, await params);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
    return handleRequest(req, await params);
}

async function handleRequest(req: NextRequest, params: { path: string[] }) {
    const aiWorkerHost = process.env.AI_WORKER_HOST || 'localhost';
    const workerPort = process.env.WORKER_PORT || '8000';
    const workerUrl = `http://${aiWorkerHost}:${workerPort}`;
    const pathStr = params.path.join('/');
    
    const url = new URL(req.url);
    const targetUrl = `${workerUrl}/${pathStr}${url.search}`;

    try {
        const body = req.method !== 'GET' ? await req.blob() : undefined;
        const response = await fetch(targetUrl, {
            method: req.method,
            headers: {
                'Content-Type': req.headers.get('content-type') || 'application/json',
            },
            body: body,
            cache: 'no-store'
        });
        
        const text = await response.text();
        return new NextResponse(text, {
            status: response.status,
            headers: {
                'Content-Type': response.headers.get('content-type') || 'application/json'
            }
        });
    } catch (e: any) {
        console.error("Proxy error:", e);
        return NextResponse.json({ error: e.message }, { status: 500 });
    }
}
