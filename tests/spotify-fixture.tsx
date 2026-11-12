import { mount, setTheme } from "nsh";
import { SpotifyWorkspace } from "../src/spotish/App";
import theme from "../src/spotish/theme.json";

setTheme(theme);
mount(SpotifyWorkspace);
