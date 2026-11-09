import type { TodoAPI } from '../shared/model';
declare global {
  interface Window {
    todo: TodoAPI;
  }
}
