/**
 * Drag-and-drop plus file-picker intake.
 *
 * dragenter/dragleave fire for every child element the pointer crosses, so the
 * highlight is driven by a counter rather than by the events alone — otherwise
 * it flickers as the cursor moves across the icon and the text.
 */
export function createDropzone({ element, input, onFile }) {
  let depth = 0;

  const setActive = (active) => element.classList.toggle('dropzone--active', active);

  element.addEventListener('click', () => input.click());
  element.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      input.click();
    }
  });

  input.addEventListener('change', () => {
    const [file] = input.files ?? [];
    if (file) onFile(file);
    // Reset so re-picking the same file still fires a change event.
    input.value = '';
  });

  // Stop the browser from navigating away when a file is dropped off-target.
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (event) => event.preventDefault());
  }

  element.addEventListener('dragenter', (event) => {
    event.preventDefault();
    depth += 1;
    setActive(true);
  });

  element.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });

  element.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) setActive(false);
  });

  element.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    setActive(false);
    const [file] = event.dataTransfer?.files ?? [];
    if (file) onFile(file);
  });
}
