# FlightFrame

**Select drone imagery for orthomosaic mapping.**

A browser-based tool to map drone photographs, select images by area, filter by flight height and camera angle, and export the originals for orthomosaic processing.

## Use

1. Open the app and choose a folder or individual photographs.
2. Filter by relative height or absolute altitude and gimbal angle (0° horizontal, 90° down).
3. Draw a polygon or rectangle; orange points are selected. Filters refine the active selection. Shapes can be edited or deleted.
4. Download the selected original images as a ZIP, or copy to a destination folder in supported browsers. Download the metadata CSV or export report as needed.

Photographs are processed locally in your browser and are never uploaded. The OpenStreetMap basemap requests tiles for the areas you view; switch it off to stop further requests. The tool selects imagery; it does not generate or quality-assure orthomosaics.

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

Tests cover a synthetic JPEG with real GPS/DJI XMP, missing/invalid metadata, angle conventions, concave polygon boundaries/date-line handling, output paths, CSV escaping, and byte-for-byte ZIP round trips. Browser import and ZIP download were also verified with the synthetic photograph. No user photographs are included.
