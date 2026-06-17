import { Composition } from "remotion";
import { VelvetPlatformPromo } from "./velvet-platform-promo";

export const VIDEO_FPS = 30;
export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const VIDEO_DURATION_FRAMES = 810;

export const RemotionRoot = () => {
  return (
    <Composition
      id="VelvetPlatformPromo"
      component={VelvetPlatformPromo}
      durationInFrames={VIDEO_DURATION_FRAMES}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
    />
  );
};
