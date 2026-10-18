# Sunset fisherman

Animations of a golden-hour sea photo with a fisherman on a boat.

- `animate_photo_v1.py`: first try, simple ripples on the photo.
- `animate_photo_v2.py`: the photo's own water flows toward the camera in perspective, plus sun glints, a bobbing boat, gulls, and a redrawn fisherman who casts, fights and lands a fish. Usage: `python3 animate_photo_v2.py photo.jpg | ffmpeg -f rawvideo -pix_fmt rgb24 -s 1080x1910 -r 30 -i - out.mp4`
- `blender/`: a full 3D version built in Blender 5.2 (`pip install bpy==5.2.2`). It has an FFT ocean simulation, a hazy golden sky matched to the photo, a boat riding the simulated waves, an animated fisherman with a bending rod, splashes, ripples, gulls and a camera push-in.
  - `python scene.py --res 0.75 --samples 12 --rows 2400 --ores 18 --anim 1 480 frames/f_`
  - `python scene.py --still 400 test.png --res 0.5`: render one test frame.
