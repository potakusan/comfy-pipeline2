// ComfyPipeline のサービスワーカー。
// 画面もデータも PC 側が持つ「いまの状態」なので、オフラインで使えるようには見せない。
// 役割は2つだけ: (1) インストール可能なアプリとして認識させる (2) VPN が切れていて PC に届かないとき、
// ブラウザの真っ白なエラーではなく、何を確認すればよいかを出す。API・画像はキャッシュしない。
const OFFLINE_URL = "/offline.html";
const CACHE = "cp2-offline-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(OFFLINE_URL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate") return; // 画面の移動だけを扱い、他は素通し
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE_URL)));
});
