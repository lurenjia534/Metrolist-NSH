import { mount, View } from "nsh";
import { Button } from "nsh/base";
import { ToastHost } from "../src/components/Toasts";
import { Label, say, toast } from "../src/ui";

function App() {
  return <View style={{ flex: 1, padding: 24, gap: 12 }}>
    <Button testID="show-first" onPress={() => say("First message")}><Label>First</Label></Button>
    <Button testID="show-second" onPress={() => say("Second message")}><Label>Second</Label></Button>
    <Button testID="clear-message" onPress={() => toast.set("")}><Label>Clear</Label></Button>
    <ToastHost />
  </View>;
}
mount(App);
