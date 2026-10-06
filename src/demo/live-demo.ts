export function wireLiveDemoButtons(root: ParentNode, openLiveDemo: () => void): void {
  root.querySelectorAll<HTMLElement>('[data-open-reader]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      openLiveDemo();
    });
  });
}
