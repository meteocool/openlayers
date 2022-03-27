/**
 * @module ol/interaction/Snap
 */
import CollectionEventType from '../CollectionEventType.js';
import EventType from '../events/EventType.js';
import GeometryType from '../geom/GeometryType.js';
import PointerInteraction from './Pointer.js';
import RBush from '../structs/RBush.js';
import VectorEventType from '../source/VectorEventType.js';
import {FALSE, TRUE} from '../functions.js';
import {boundingExtent, createEmpty} from '../extent.js';
import {
  closestOnCircle,
  closestOnSegment,
  squaredDistance,
} from '../coordinate.js';
import {fromCircle} from '../geom/Polygon.js';
import {
  fromUserCoordinate,
  getUserProjection,
  toUserCoordinate,
} from '../proj.js';
import {getUid} from '../util.js';
import {getValues} from '../obj.js';
import {listen, unlistenByKey} from '../events.js';

/**
 * @typedef {Object} Result
 * @property {import("../coordinate.js").Coordinate|null} vertex Vertex.
 * @property {import("../pixel.js").Pixel|null} vertexPixel VertexPixel.
 */

/**
 * @typedef {Object} SegmentData
 * @property {import("../Feature.js").default} feature Feature.
 * @property {Array<import("../coordinate.js").Coordinate>} segment Segment.
 */

/**
 * @typedef {Object} Options
 * @property {import("../Collection.js").default<import("../Feature.js").default>} [features] Snap to these features. Either this option or source should be provided.
 * @property {boolean} [edge=true] Snap to edges.
 * @property {boolean} [vertex=true] Snap to vertices.
 * @property {number} [pixelTolerance=10] Pixel tolerance for considering the pointer close enough to a segment or
 * vertex for snapping.
 * @property {import("../source/Vector.js").default} [source] Snap to features from this source. Either this option or features should be provided
 */

/**
 * @param  {import("../source/Vector.js").VectorSourceEvent|import("../Collection.js").CollectionEvent} evt Event.
 * @return {import("../Feature.js").default} Feature.
 */
function getFeatureFromEvent(evt) {
  if (
    /** @type {import("../source/Vector.js").VectorSourceEvent} */ (evt).feature
  ) {
    return /** @type {import("../source/Vector.js").VectorSourceEvent} */ (evt)
      .feature;
  } else if (
    /** @type {import("../Collection.js").CollectionEvent} */ (evt).element
  ) {
    return /** @type {import("../Feature.js").default} */ (
      /** @type {import("../Collection.js").CollectionEvent} */ (evt).element
    );
  }
}

const tempSegment = [];

/**
 * @classdesc
 * Handles snapping of vector features while modifying or drawing them.  The
 * features can come from a {@link module:ol/source/Vector~VectorSource} or {@link module:ol/Collection~Collection}
 * Any interaction object that allows the user to interact
 * with the features using the mouse can benefit from the snapping, as long
 * as it is added before.
 *
 * The snap interaction modifies map browser event `coordinate` and `pixel`
 * properties to force the snap to occur to any interaction that them.
 *
 * Example:
 *
 *     import Snap from 'ol/interaction/Snap';
 *
 *     const snap = new Snap({
 *       source: source
 *     });
 *
 *     map.addInteraction(snap);
 *
 * @api
 */
class Snap extends PointerInteraction {
  /**
   * @param {Options} [opt_options] Options.
   */
  constructor(opt_options) {
    const options = opt_options ? opt_options : {};

    const pointerOptions = /** @type {import("./Pointer.js").Options} */ (
      options
    );

    if (!pointerOptions.handleDownEvent) {
      pointerOptions.handleDownEvent = TRUE;
    }

    if (!pointerOptions.stopDown) {
      pointerOptions.stopDown = FALSE;
    }

    super(pointerOptions);

    /**
     * @type {import("../source/Vector.js").default|null}
     * @private
     */
    this.source_ = options.source ? options.source : null;

    /**
     * @private
     * @type {boolean}
     */
    this.vertex_ = options.vertex !== undefined ? options.vertex : true;

    /**
     * @private
     * @type {boolean}
     */
    this.edge_ = options.edge !== undefined ? options.edge : true;

    /**
     * @type {import("../Collection.js").default<import("../Feature.js").default>|null}
     * @private
     */
    this.features_ = options.features ? options.features : null;

    /**
     * @type {Array<import("../events.js").EventsKey>}
     * @private
     */
    this.featuresListenerKeys_ = [];

    /**
     * @type {Object<string, import("../events.js").EventsKey>}
     * @private
     */
    this.featureChangeListenerKeys_ = {};

    /**
     * Extents are preserved so indexed segment can be quickly removed
     * when its feature geometry changes
     * @type {Object<string, import("../extent.js").Extent>}
     * @private
     */
    this.indexedFeaturesExtents_ = {};

    /**
     * If a feature geometry changes while a pointer drag|move event occurs, the
     * feature doesn't get updated right away.  It will be at the next 'pointerup'
     * event fired.
     * @type {!Object<string, import("../Feature.js").default>}
     * @private
     */
    this.pendingFeatures_ = {};

    /**
     * @type {number}
     * @private
     */
    this.pixelTolerance_ =
      options.pixelTolerance !== undefined ? options.pixelTolerance : 10;

    /**
     * Segment RTree for each layer
     * @type {import("../structs/RBush.js").default<SegmentData>}
     * @private
     */
    this.rBush_ = new RBush();

    /**
     * @const
     * @private
     * @type {Object<string, function(Array<Array<import('../coordinate.js').Coordinate>>, import("../geom/Geometry.js").default): void>}
     */
    this.GEOMETRY_SEGMENTERS_ = {
      'Point': this.segmentPointGemetry_.bind(this),
      'LineString': this.segmentLineStringGemetry_.bind(this),
      'LinearRing': this.segmentLineStringGemetry_.bind(this),
      'Polygon': this.segmentPolygonGemetry_.bind(this),
      'MultiPoint': this.segmentMultiPointGemetry_.bind(this),
      'MultiLineString': this.segmentMultiLineStringGemetry_.bind(this),
      'MultiPolygon': this.segmentMultiPolygonGemetry_.bind(this),
      'GeometryCollection': this.segmentGeometryCollectionGemetry_.bind(this),
      'Circle': this.segmentCircleGemetry_.bind(this),
    };
  }

  /**
   * Add a feature to the collection of features that we may snap to.
   * @param {import("../Feature.js").default} feature Feature.
   * @param {boolean} [opt_listen] Whether to listen to the feature change or not
   *     Defaults to `true`.
   * @api
   */
  addFeature(feature, opt_listen) {
    const register = opt_listen !== undefined ? opt_listen : true;
    const feature_uid = getUid(feature);
    const geometry = feature.getGeometry();
    if (geometry) {
      const segmenter = this.GEOMETRY_SEGMENTERS_[geometry.getType()];
      if (segmenter) {
        this.indexedFeaturesExtents_[feature_uid] = geometry.getExtent(
          createEmpty()
        );
        const segments =
          /** @type {Array<Array<import('../coordinate.js').Coordinate>>} */ ([]);
        segmenter(segments, geometry);
        if (segments.length === 1) {
          this.rBush_.insert(boundingExtent(segments[0]), {
            feature: feature,
            segment: segments[0],
          });
        } else if (segments.length > 1) {
          const extents = segments.map((s) => boundingExtent(s));
          const segmentsData = segments.map((segment) => ({
            feature: feature,
            segment: segment,
          }));
          this.rBush_.load(extents, segmentsData);
        }
      }
    }

    if (register) {
      this.featureChangeListenerKeys_[feature_uid] = listen(
        feature,
        EventType.CHANGE,
        this.handleFeatureChange_,
        this
      );
    }
  }

  /**
   * @param {import("../Feature.js").default} feature Feature.
   * @private
   */
  forEachFeatureAdd_(feature) {
    this.addFeature(feature);
  }

  /**
   * @param {import("../Feature.js").default} feature Feature.
   * @private
   */
  forEachFeatureRemove_(feature) {
    this.removeFeature(feature);
  }

  /**
   * @return {import("../Collection.js").default<import("../Feature.js").default>|Array<import("../Feature.js").default>} Features.
   * @private
   */
  getFeatures_() {
    let features;
    if (this.features_) {
      features = this.features_;
    } else if (this.source_) {
      features = this.source_.getFeatures();
    }
    return features;
  }

  /**
   * @param {import("../MapBrowserEvent.js").default} evt Map browser event.
   * @return {boolean} `false` to stop event propagation.
   */
  handleEvent(evt) {
    const result = this.snapTo(evt.pixel, evt.coordinate, evt.map);
    if (result) {
      evt.coordinate = result.vertex.slice(0, 2);
      evt.pixel = result.vertexPixel;
    }
    return super.handleEvent(evt);
  }

  /**
   * @param {import("../source/Vector.js").VectorSourceEvent|import("../Collection.js").CollectionEvent} evt Event.
   * @private
   */
  handleFeatureAdd_(evt) {
    const feature = getFeatureFromEvent(evt);
    this.addFeature(feature);
  }

  /**
   * @param {import("../source/Vector.js").VectorSourceEvent|import("../Collection.js").CollectionEvent} evt Event.
   * @private
   */
  handleFeatureRemove_(evt) {
    const feature = getFeatureFromEvent(evt);
    this.removeFeature(feature);
  }

  /**
   * @param {import("../events/Event.js").default} evt Event.
   * @private
   */
  handleFeatureChange_(evt) {
    const feature = /** @type {import("../Feature.js").default} */ (evt.target);
    if (this.handlingDownUpSequence) {
      const uid = getUid(feature);
      if (!(uid in this.pendingFeatures_)) {
        this.pendingFeatures_[uid] = feature;
      }
    } else {
      this.updateFeature_(feature);
    }
  }

  /**
   * Handle pointer up events.
   * @param {import("../MapBrowserEvent.js").default} evt Event.
   * @return {boolean} If the event was consumed.
   */
  handleUpEvent(evt) {
    const featuresToUpdate = getValues(this.pendingFeatures_);
    if (featuresToUpdate.length) {
      featuresToUpdate.forEach(this.updateFeature_.bind(this));
      this.pendingFeatures_ = {};
    }
    return false;
  }

  /**
   * Remove a feature from the collection of features that we may snap to.
   * @param {import("../Feature.js").default} feature Feature
   * @param {boolean} [opt_unlisten] Whether to unlisten to the feature change
   *     or not. Defaults to `true`.
   * @api
   */
  removeFeature(feature, opt_unlisten) {
    const unregister = opt_unlisten !== undefined ? opt_unlisten : true;
    const feature_uid = getUid(feature);
    const extent = this.indexedFeaturesExtents_[feature_uid];
    if (extent) {
      const rBush = this.rBush_;
      const nodesToRemove = [];
      rBush.forEachInExtent(extent, function (node) {
        if (feature === node.feature) {
          nodesToRemove.push(node);
        }
      });
      for (let i = nodesToRemove.length - 1; i >= 0; --i) {
        rBush.remove(nodesToRemove[i]);
      }
    }

    if (unregister) {
      unlistenByKey(this.featureChangeListenerKeys_[feature_uid]);
      delete this.featureChangeListenerKeys_[feature_uid];
    }
  }

  /**
   * Remove the interaction from its current map and attach it to the new map.
   * Subclasses may set up event handlers to get notified about changes to
   * the map here.
   * @param {import("../PluggableMap.js").default} map Map.
   */
  setMap(map) {
    const currentMap = this.getMap();
    const keys = this.featuresListenerKeys_;
    const features = /** @type {Array<import("../Feature.js").default>} */ (
      this.getFeatures_()
    );

    if (currentMap) {
      keys.forEach(unlistenByKey);
      keys.length = 0;
      features.forEach(this.forEachFeatureRemove_.bind(this));
    }
    super.setMap(map);

    if (map) {
      if (this.features_) {
        keys.push(
          listen(
            this.features_,
            CollectionEventType.ADD,
            this.handleFeatureAdd_,
            this
          ),
          listen(
            this.features_,
            CollectionEventType.REMOVE,
            this.handleFeatureRemove_,
            this
          )
        );
      } else if (this.source_) {
        keys.push(
          listen(
            this.source_,
            VectorEventType.ADDFEATURE,
            this.handleFeatureAdd_,
            this
          ),
          listen(
            this.source_,
            VectorEventType.REMOVEFEATURE,
            this.handleFeatureRemove_,
            this
          )
        );
      }
      features.forEach(this.forEachFeatureAdd_.bind(this));
    }
  }

  /**
   * @param {import("../pixel.js").Pixel} pixel Pixel
   * @param {import("../coordinate.js").Coordinate} pixelCoordinate Coordinate
   * @param {import("../PluggableMap.js").default} map Map.
   * @return {Result|null} Snap result
   */
  snapTo(pixel, pixelCoordinate, map) {
    const lowerLeft = map.getCoordinateFromPixel([
      pixel[0] - this.pixelTolerance_,
      pixel[1] + this.pixelTolerance_,
    ]);
    const upperRight = map.getCoordinateFromPixel([
      pixel[0] + this.pixelTolerance_,
      pixel[1] - this.pixelTolerance_,
    ]);
    const box = boundingExtent([lowerLeft, upperRight]);

    const segments = this.rBush_.getInExtent(box);

    const segmentsLength = segments.length;
    if (segmentsLength === 0) {
      return null;
    }

    const projection = map.getView().getProjection();
    const projectedCoordinate = fromUserCoordinate(pixelCoordinate, projection);

    let closestVertex;
    let minSquaredDistance = Infinity;

    const squaredPixelTolerance = this.pixelTolerance_ * this.pixelTolerance_;
    const getResult = () => {
      if (closestVertex) {
        const vertexPixel = map.getPixelFromCoordinate(closestVertex);
        const squaredPixelDistance = squaredDistance(pixel, vertexPixel);
        if (squaredPixelDistance <= squaredPixelTolerance) {
          return {
            vertex: closestVertex,
            vertexPixel: [
              Math.round(vertexPixel[0]),
              Math.round(vertexPixel[1]),
            ],
          };
        }
      }
      return null;
    };

    if (this.vertex_) {
      for (let i = 0; i < segmentsLength; ++i) {
        const segmentData = segments[i];
        if (
          segmentData.feature.getGeometry().getType() !== GeometryType.CIRCLE
        ) {
          segmentData.segment.forEach((vertex) => {
            const tempVertexCoord = fromUserCoordinate(vertex, projection);
            const delta = squaredDistance(projectedCoordinate, tempVertexCoord);
            if (delta < minSquaredDistance) {
              closestVertex = vertex;
              minSquaredDistance = delta;
            }
          });
        }
      }
      const result = getResult();
      if (result) {
        return result;
      }
    }

    if (this.edge_) {
      for (let i = 0; i < segmentsLength; ++i) {
        let vertex = null;
        const segmentData = segments[i];
        if (
          segmentData.feature.getGeometry().getType() === GeometryType.CIRCLE
        ) {
          let circleGeometry = segmentData.feature.getGeometry();
          const userProjection = getUserProjection();
          if (userProjection) {
            circleGeometry = circleGeometry
              .clone()
              .transform(userProjection, projection);
          }
          vertex = toUserCoordinate(
            closestOnCircle(
              projectedCoordinate,
              /** @type {import("../geom/Circle.js").default} */ (
                circleGeometry
              )
            ),
            projection
          );
        } else {
          const [segmentStart, segmentEnd] = segmentData.segment;
          // points have only one coordinate
          if (segmentEnd) {
            tempSegment[0] = fromUserCoordinate(segmentStart, projection);
            tempSegment[1] = fromUserCoordinate(segmentEnd, projection);
            vertex = closestOnSegment(projectedCoordinate, tempSegment);
          }
        }
        if (vertex) {
          const delta = squaredDistance(projectedCoordinate, vertex);
          if (delta < minSquaredDistance) {
            closestVertex = vertex;
            minSquaredDistance = delta;
          }
        }
      }

      const result = getResult();
      if (result) {
        return result;
      }
    }

    return null;
  }

  /**
   * @param {import("../Feature.js").default} feature Feature
   * @private
   */
  updateFeature_(feature) {
    this.removeFeature(feature, false);
    this.addFeature(feature, false);
  }

  /**
   * @param {Array<Array<import('../coordinate.js').Coordinate>>} segments Segments
   * @param {import("../geom/Circle.js").default} geometry Geometry.
   * @private
   */
  segmentCircleGemetry_(segments, geometry) {
    const projection = this.getMap().getView().getProjection();
    let circleGeometry = geometry;
    const userProjection = getUserProjection();
    if (userProjection) {
      circleGeometry = /** @type {import("../geom/Circle.js").default} */ (
        circleGeometry.clone().transform(userProjection, projection)
      );
    }
    const polygon = fromCircle(circleGeometry);
    if (userProjection) {
      polygon.transform(projection, userProjection);
    }
    const coordinates = polygon.getCoordinates()[0];
    for (let i = 0, ii = coordinates.length - 1; i < ii; ++i) {
      segments.push(coordinates.slice(i, i + 2));
    }
  }

  /**
   * @param {Array<Array<import('../coordinate.js').Coordinate>>} segments Segments
   * @param {import("../geom/GeometryCollection.js").default} geometry Geometry.
   * @private
   */
  segmentGeometryCollectionGemetry_(segments, geometry) {
    const geometries = geometry.getGeometriesArray();
    for (let i = 0; i < geometries.length; ++i) {
      const segmenter = this.GEOMETRY_SEGMENTERS_[geometries[i].getType()];
      if (segmenter) {
        segmenter(segments, geometries[i]);
      }
    }
  }

  /**
   * @param {Array<Array<import('../coordinate.js').Coordinate>>} segments Segments
   * @param {import("../geom/LineString.js").default} geometry Geometry.
   * @private
   */
  segmentLineStringGemetry_(segments, geometry) {
    const coordinates = geometry.getCoordinates();
    for (let i = 0, ii = coordinates.length - 1; i < ii; ++i) {
      segments.push(coordinates.slice(i, i + 2));
    }
  }

  /**
   * @param {Array<Array<import('../coordinate.js').Coordinate>>} segments Segments
   * @param {import("../geom/MultiLineString.js").default} geometry Geometry.
   * @private
   */
  segmentMultiLineStringGemetry_(segments, geometry) {
    const lines = geometry.getCoordinates();
    for (let j = 0, jj = lines.length; j < jj; ++j) {
      const coordinates = lines[j];
      for (let i = 0, ii = coordinates.length - 1; i < ii; ++i) {
        segments.push(coordinates.slice(i, i + 2));
      }
    }
  }

  /**
   * @param {Array<Array<import('../coordinate.js').Coordinate>>} segments Segments
   * @param {import("../geom/MultiPoint.js").default} geometry Geometry.
   * @private
   */
  segmentMultiPointGemetry_(segments, geometry) {
    geometry.getCoordinates().forEach((point) => {
      segments.push([point]);
    });
  }

  /**
   * @param {Array<Array<import('../coordinate.js').Coordinate>>} segments Segments
   * @param {import("../geom/MultiPolygon.js").default} geometry Geometry.
   * @private
   */
  segmentMultiPolygonGemetry_(segments, geometry) {
    const polygons = geometry.getCoordinates();
    for (let k = 0, kk = polygons.length; k < kk; ++k) {
      const rings = polygons[k];
      for (let j = 0, jj = rings.length; j < jj; ++j) {
        const coordinates = rings[j];
        for (let i = 0, ii = coordinates.length - 1; i < ii; ++i) {
          segments.push(coordinates.slice(i, i + 2));
        }
      }
    }
  }

  /**
   * @param {Array<Array<import('../coordinate.js').Coordinate>>} segments Segments
   * @param {import("../geom/Point.js").default} geometry Geometry.
   * @private
   */
  segmentPointGemetry_(segments, geometry) {
    segments.push([geometry.getCoordinates()]);
  }

  /**
   * @param {Array<Array<import('../coordinate.js').Coordinate>>} segments Segments
   * @param {import("../geom/Polygon.js").default} geometry Geometry.
   * @private
   */
  segmentPolygonGemetry_(segments, geometry) {
    const rings = geometry.getCoordinates();
    for (let j = 0, jj = rings.length; j < jj; ++j) {
      const coordinates = rings[j];
      for (let i = 0, ii = coordinates.length - 1; i < ii; ++i) {
        segments.push(coordinates.slice(i, i + 2));
      }
    }
  }
}

export default Snap;