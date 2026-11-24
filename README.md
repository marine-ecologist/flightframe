# FlightFrame

**Select drone imagery for orthomosaic mapping.**

A browser-based tool to map drone photographs, select images by area, filter by flight height and camera angle, and export the originals for orthomosaic processing.

## Use

1. Open the app and choose a folder or individual photographs.
2. Filter by relative height or absolute altitude and gimbal angle (0° horizontal, 90° down).
3. Draw a polygon or rectangle; orange points are selected. Filters refine the active selection. Shapes can be edited or deleted.
4. Download the selected original images as a ZIP, or copy to a destination folder in supported browsers. Download the metadata CSV or export report as needed.

Photographs are processed locally in your browser and are never uploaded. The OpenStreetMap basemap requests tiles for the areas you view; switch it off to stop further requests. The tool selects imagery; it does not generate or quality-assure orthomosaics.

## DJI video to geotagged stills

Open **DJI video to geotagged stills**, choose one MP4/MOV and its matching `.SRT`, then choose a frame interval and clip start/end. Click **Extract geotagged stills**. Completed extraction replaces the current survey; you can use the existing map, polygon/rectangle selection, filters, ZIP and folder export on the resulting JPEGs. Cancellation preserves the previous survey.

- Frames retain the decoded video dimensions and are re-encoded as JPEGs at the chosen quality. GPS latitude/longitude and available absolute altitude are embedded in EXIF; relative height and gimbal pitch/yaw/roll are embedded in DJI-style XMP. Source clip/SRT, timing, and assumptions are recorded in FlightFrame XMP and the metadata CSV. Video source files remain unchanged.
- Missing gimbal pitch **defaults to assumed −90° (straight down)**. This fallback is labelled as user supplied and never overrides a pitch actually recorded in the SRT. Clear the fallback field to leave an unknown pitch unset. Aircraft pitch is not substituted for gimbal pitch.
- SRT cues with zero/zero coordinates, missing GPS, or out-of-range coordinates are skipped. If an entire SRT has no usable GPS, it cannot locate the frames. A different flight’s telemetry must not be substituted. Standard photo imports still accept geographically valid `(0,0)` coordinates.
- Modern bracketed DJI telemetry and older `GPS(a,b,alt)` / `G.PRY(p,r,y)` formats are supported. Legacy tuple order is selectable; bracketed latitude/longitude are explicit. No flight-log CSV, embedded MP4 telemetry-track extraction, GPX import, or interpolation is performed.
- Default matching requires the frame time to fall inside a valid GPS cue. Advanced settings allow a small gap tolerance and a timing offset: **SRT seconds = video seconds + offset**. Unmatched/duplicate decoded frames are skipped. Decoded frame timestamps are used where the browser supplies them; seek-timeline estimates are labelled. SRT date/time is kept as wall clock without inventing a timezone.
- Missing/unsupported gimbal angles and missing heights are included automatically after extraction when needed; you can refine the filters afterwards. Relative height and absolute altitude stay distinct, with the SRT altitude datum unverified.
- Batches are limited to 2,000 stills and 500 MB of generated JPEGs, and SRT input is limited to 100 MB. Use shorter clip ranges or larger intervals for long/high-resolution videos. H.264 MP4 is the most portable input; H.265/HEVC depends on your browser/system. The app does not transcode unsupported codecs.
- ZIP exports containing video stills include `_flightframe-metadata.csv` and an export report. For direct folder export, download the metadata CSV separately.

These are **camera-position geotags**, not ground-pixel georeferencing or orthorectification. The app does not generate world files, footprints, corrected terrain, or an orthomosaic. Extraction intervals do not guarantee adequate overlap, sharpness, camera calibration, or survey accuracy.

## GitHub Pages

The included workflow publishes `public/` whenever `main` changes. In **Settings → Pages**, choose **GitHub Actions** as the publishing source. The deployed address is:

https://marine-ecologist.github.io/flightframe/

No R, ExifTool, backend, API key, or build step is needed to serve the app. Browser libraries are included in `public/vendor/` with their licences.

## Local development

```sh
npm ci
npm test
npm start
```

Open http://localhost:7392. After changing dependency versions, run `npm run vendor` and commit the updated vendor files. Serve over HTTP/HTTPS rather than double-clicking `index.html`.

## Notes

- Embedded EXIF and XMP are read with exifr. DJI relative altitude and gimbal pitch are supported; manufacturer-specific maker notes and unusual RAW formats may not be. Unsupported/corrupt images remain in the inventory with missing fields or a reader error. Separate `.xmp` sidecars are not merged or exported.
- Raw signed pitch and source tags are retained. The default 0–90° filter uses pitch magnitude; choose the DJI signed or positive-downward convention when appropriate. Flight pitch and image rotation are never substituted for camera pitch. Missing height/angle values are excluded unless enabled explicitly. Invalid/missing GPS cannot be selected on the map.
- Relative height often refers to takeoff, not terrain; absolute altitude datums vary. Check a known photograph from your camera before selecting a survey.
- Folder imports retain the selected root folder and its subfolders in exports. Duplicate or unsafe output names are sanitised/disambiguated and recorded in the export report. Existing destination files are skipped. Originals remain unchanged.
- ZIP generation uses memory and is capped at 750 MB of selected originals. Use smaller batches or direct folder export for larger surveys. Direct folder export requires a supporting browser (typically desktop Chrome/Edge), HTTPS or localhost, and permission to write to the chosen destination. ZIP downloads work without that API.
- The inventory previews 500 rows; CSV and exports include all applicable files. Reloading the page clears the session. Very large surveys may be slow to render.

Tests cover DJI SRT parsing, zero-GPS rejection, missing-angle fallbacks, timestamp matching, frame schedules, generated JPEG EXIF/XMP round trips, and a synthetic JPEG with real GPS/DJI XMP, missing/invalid metadata, angle conventions, concave polygon boundaries/date-line handling, output paths, CSV escaping, and byte-for-byte ZIP round trips. Browser import and ZIP download were also verified with the synthetic photograph. No user photographs are included.

Video validation: 15 automated checks pass. A synthetic H.264 clip and SRT were processed through the browser into three full-resolution JPEGs, downloaded as a ZIP, and independently read with ExifTool to verify GPS, height and camera angles. Test fixtures are synthetic; user telemetry is not included in this repository.
