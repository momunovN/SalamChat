self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const visible = windows.some((client) => client.visibilityState === "visible");
      if (visible) return;
      await self.registration.showNotification(data.title || "Salam", {
        body: data.body || "",
        icon: "/apple-icon.png",
        badge: "/apple-icon.png",
        tag: data.tag || "salam",
        renotify: data.kind === "call",
        data: { url: data.url || "/" },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(url);
            } catch {
              /* the open tab stays where it is */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
