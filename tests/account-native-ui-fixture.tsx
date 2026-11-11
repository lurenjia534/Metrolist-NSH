import { host } from "nsh";
import "../App";

// The independent test host emits Google progress and a fixture session while login stays open.
void host.call("auth.test.auto", {
  delay: 500,
  credentials: { cookie: "SAPISID=login-ui-fixture", authUser: "0", dataSyncId: "login-ui-sync", visitorData: "login-ui-visitor" },
});
