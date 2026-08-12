use core::pin::Pin;
use core::task::{Context, Poll};
use std::io;

use futures_util::io::{AsyncRead, AsyncWrite};
use js_sys::{Object, Promise, Reflect};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use wasm_streams::readable::IntoAsyncRead;
use wasm_streams::writable::IntoAsyncWrite;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = TCPSocket)]
    #[derive(Debug)]
    type TcpSocket;

    #[wasm_bindgen(constructor, catch, js_class = TCPSocket)]
    fn new(address: &str, port: u16, options: &Object) -> Result<TcpSocket, JsValue>;

    #[wasm_bindgen(method, getter)]
    fn opened(this: &TcpSocket) -> Promise;
}

/// A `futures-io` stream backed by the IWA Direct Sockets API.
#[derive(Debug)]
pub(crate) struct DirectSocket {
    _socket: TcpSocket,
    reader: IntoAsyncRead<'static>,
    writer: IntoAsyncWrite<'static>,
}

impl DirectSocket {
    pub(crate) async fn connect(destination: &str) -> anyhow::Result<(Self, String)> {
        let (host, port) = parse_destination(destination)?;

        let options = Object::new();
        Reflect::set(&options, &"keepAlive".into(), &true.into()).map_err(js_error)?;
        Reflect::set(&options, &"noDelay".into(), &true.into()).map_err(js_error)?;

        let socket = TcpSocket::new(&host, port, &options).map_err(js_error)?;
        let opened = JsFuture::from(socket.opened()).await.map_err(js_error)?;
        let readable = Reflect::get(&opened, &"readable".into())
            .map_err(js_error)?
            .dyn_into::<web_sys::ReadableStream>()
            .map_err(js_error)?;
        let writable = Reflect::get(&opened, &"writable".into())
            .map_err(js_error)?
            .dyn_into::<web_sys::WritableStream>()
            .map_err(js_error)?;

        let reader = wasm_streams::ReadableStream::from_raw(readable)
            .try_into_async_read()
            .map_err(|(error, _)| anyhow::anyhow!("Direct Socket readable stream is not a byte stream: {error:?}"))?;
        let writer = wasm_streams::WritableStream::from_raw(writable).into_async_write();

        Ok((
            Self {
                _socket: socket,
                reader,
                writer,
            },
            host,
        ))
    }
}

impl AsyncRead for DirectSocket {
    fn poll_read(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &mut [u8]) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.reader).poll_read(cx, buf)
    }
}

impl AsyncWrite for DirectSocket {
    fn poll_write(mut self: Pin<&mut Self>, cx: &mut Context<'_>, buf: &[u8]) -> Poll<io::Result<usize>> {
        Pin::new(&mut self.writer).poll_write(cx, buf)
    }

    fn poll_flush(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.writer).poll_flush(cx)
    }

    fn poll_close(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<io::Result<()>> {
        Pin::new(&mut self.writer).poll_close(cx)
    }
}

fn parse_destination(destination: &str) -> anyhow::Result<(String, u16)> {
    let url = url::Url::parse(&format!("rdp://{destination}"))
        .map_err(|error| anyhow::anyhow!("invalid RDP destination: {error}"))?;
    let host = url
        .host_str()
        .filter(|host| !host.is_empty())
        .ok_or_else(|| anyhow::anyhow!("RDP destination is missing a hostname"))?
        .to_owned();
    let port = url.port().unwrap_or(3389);
    Ok((host, port))
}

fn js_error(value: JsValue) -> anyhow::Error {
    let message = value
        .as_string()
        .or_else(|| Reflect::get(&value, &"message".into()).ok()?.as_string())
        .unwrap_or_else(|| format!("{value:?}"));
    anyhow::anyhow!(message)
}
