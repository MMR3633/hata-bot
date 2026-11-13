import socket
import struct


class RconError(Exception):
    pass


class Rcon:
    """Минимальный клиент Source RCON, которым говорит Minecraft."""

    def __init__(self, host, port, password, timeout=5):
        self.host, self.port, self.password, self.timeout = host, port, password, timeout
        self.sock = None
        self.req = 0

    def __enter__(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        if self._send(3, self.password)[0] == -1:
            raise RconError("неверный пароль RCON")
        return self

    def __exit__(self, *exc):
        self.sock.close()

    def _recv_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.sock.recv(n - len(buf))
            if not chunk:
                raise RconError("соединение закрыто")
            buf += chunk
        return buf

    def _send(self, kind, body):
        self.req += 1
        payload = struct.pack("<ii", self.req, kind) + body.encode("utf-8") + b"\x00\x00"
        self.sock.sendall(struct.pack("<i", len(payload)) + payload)
        size = struct.unpack("<i", self._recv_exact(4))[0]
        data = self._recv_exact(size)
        req_id, _ = struct.unpack("<ii", data[:8])
        return req_id, data[8:-2].decode("utf-8", "replace")

    def cmd(self, command):
        return self._send(2, command)[1]
