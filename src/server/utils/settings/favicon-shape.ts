import {
  DEFAULT_FAVICON_SHAPE,
  FAVICON_SHAPE_SETTING,
  isFaviconShape,
  type FaviconShape,
} from "../../../shared/favicon-shapes";
import { getInstanceSettings } from "./server-settings";

export const getFaviconShape = async (): Promise<FaviconShape> => {
  const value = (await getInstanceSettings())[FAVICON_SHAPE_SETTING];
  return isFaviconShape(value) ? value : DEFAULT_FAVICON_SHAPE;
};

export const faviconShapeAttr = async (): Promise<string> =>
  ` data-favicon-shape="${await getFaviconShape()}"`;
