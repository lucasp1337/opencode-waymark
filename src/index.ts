import type { server as v1Server } from "./host/v1";

type ServerArgs = Parameters<typeof v1Server>;

export default {
  id: "waymark",
  async server(...args: ServerArgs) {
    const { server } = await import("./host/v1");
    return server(...args);
  },
};
