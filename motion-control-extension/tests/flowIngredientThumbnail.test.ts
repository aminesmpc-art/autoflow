import { findAttachedIngredients, findLoadedIngredients, waitForIngredients } from '../../studio-extension/src/content/flow/selectors';

// Structural markup from the supplied live bar; signed URL parameters omitted.
const still = `<flow-ingredient-chip><flow-image-ingredient-chip>
  <button class="chip-container" aria-label="Ingredient" aria-busy="false"><div class="chip-image-wrapper">
  <img alt="Ingredient image" class="chip-image" src="https://flow-content.google/image/3ef6802c-0b6a-42df-8e27-3be376a643e0">
  </div><div class="hover-icon-overlay"><mat-icon>cancel</mat-icon></div></button>
  </flow-image-ingredient-chip></flow-ingredient-chip>`;
const video = `<flow-ingredient-chip><flow-video-ingredient-chip>
  <button class="chip-container" aria-label="Ingredient" aria-busy="false"><div class="chip-image-wrapper">
  <img alt="Video ingredient image" class="chip-image" src="https://storage.googleapis.com/ai-sandbox-videofx/image/23e0f6fe-5f0a-4058-9dde-81ddfb8cb4ce">
  </div><div class="hover-icon-overlay"><mat-icon>cancel</mat-icon></div><mat-icon class="type-badge">videocam</mat-icon></button>
  </flow-video-ingredient-chip></flow-ingredient-chip>`;

function loadImage(image: HTMLImageElement, ready = true) {
  Object.defineProperty(image, 'complete', { configurable: true, value: ready });
  Object.defineProperty(image, 'naturalWidth', { configurable: true, value: ready ? 512 : 0 });
}
beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = `<flow-ingredient-bar><div class="ingredient-bar-container">${still}${video}</div></flow-ingredient-bar>`;
  jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 48, height: 48, top: 0, left: 0, right: 48, bottom: 48 } as DOMRect);
  for (const image of document.querySelectorAll<HTMLImageElement>('img')) loadImage(image);
});
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); document.body.innerHTML = ''; });

test('the live bar has two attached and loaded ingredients, not one', () => {
  expect(findAttachedIngredients()).toHaveLength(2);
  expect(findLoadedIngredients()).toHaveLength(2);
});
test('the pre-submit wait accepts the supplied ready bar', async () => {
  const waiting = waitForIngredients(2, 2000);
  await jest.advanceTimersByTimeAsync(2500);
  expect(await waiting).toBe(true);
});
test('an unloaded thumbnail remains attached but cannot satisfy readiness', async () => {
  loadImage(document.querySelector('flow-video-ingredient-chip img')!, false);
  expect(findAttachedIngredients()).toHaveLength(2);
  expect(findLoadedIngredients()).toHaveLength(1);
  const waiting = waitForIngredients(2, 1500);
  await jest.advanceTimersByTimeAsync(1500);
  expect(await waiting).toBe(false);
});
test('busy and placeholder video chips cannot satisfy readiness', () => {
  const button = document.querySelector('flow-video-ingredient-chip button')!;
  button.setAttribute('aria-busy', 'true');
  expect(findLoadedIngredients()).toHaveLength(1);
  button.setAttribute('aria-busy', 'false');
  button.insertAdjacentHTML('afterbegin', '<div class="chip-placeholder"></div>');
  expect(findLoadedIngredients()).toHaveLength(1);
});
test('past batch ingredients and loose library images do not inflate the count', () => {
  document.body.insertAdjacentHTML('afterbegin', `<flow-batch-info><div class="ingredients-list">${video}</div></flow-batch-info><img src="https://storage.googleapis.com/ai-sandbox-videofx/image/library">`);
  for (const image of document.querySelectorAll<HTMLImageElement>('img')) loadImage(image);
  expect(findLoadedIngredients()).toHaveLength(2);
});
test('the existing real-video chip remains supported', () => {
  const image = document.querySelector('flow-video-ingredient-chip img')!;
  image.outerHTML = '<video src="https://flow-content.google/video/clip"></video>';
  expect(findLoadedIngredients()).toHaveLength(2);
});
