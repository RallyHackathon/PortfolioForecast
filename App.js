var Lumenize = require('./lumenize')
var NOW = new Date();

Ext.define('Rally.ui.tree.PortfolioForecastTreeItem', {
    extend: 'Rally.ui.tree.TreeItem',
    alias: 'widget.rallyportfolioforecasttreeitem',

    getContentTpl: function(){
        var me = this;

        return Ext.create('Ext.XTemplate',
            '<div class="textContent ellipses">{[this.getFormattedId()]} {[this.getSeparator()]}{Name}</div>',
            '<div class="textContent {[values.AtRisk ? "atRisk" : "notAtRisk"]}">({[values.DaysToCompletion.toFixed(1)]} days needed/{WorkdaysRemaining} days left)</div>',
            '<div class="rightSide">',
                '{[this.getPercentDone()]}',
            '</div>',
            {
                getPercentDone: function() {
                    var record = me.getRecord();
                    return record.getField('PercentDoneByStoryCount') ? Rally.ui.renderer.RendererFactory.renderRecordField(me.getRecord(), 'PercentDoneByStoryCount') : '';
                },
                getFormattedId: function() {
                    var record = me.getRecord();
                    return record.getField('FormattedID') ? Rally.ui.renderer.RendererFactory.renderRecordField(record, 'FormattedID') : '';
                },
                getSeparator: function() {
                    return this.getFormattedId() ? '- ' : '';
                }
            }
        );
    }
});

Ext.define('Rally.ui.tree.PortfolioForecastTree', {
    extend: 'Rally.ui.tree.PortfolioTree',
    alias: 'widget.portfolioforecasttree',

    requires: [
        'Rally.data.lookback.SnapshotStore'
    ],

    handleParentItemStoreLoad: function(store, records) {
        //Compute risk (should always be a portfolio item)
        var originalArguments = arguments;
        this.loadStoriesRemainingByFeatureAndProject(Ext.bind(function() {
            this.computePortfolioItemRisk(store);
            this.superclass.handleParentItemStoreLoad.apply(this, originalArguments);
        }, this));
    },

    handleChildItemStoreLoad: function(store, records, parentTreeItem) {
        this.computePortfolioItemRisk(store);
        this.callParent(arguments);
    },

    drawChildItems: function (parentTreeItem) {
        var record = parentTreeItem.getRecord();
        if (this._isRecordBottomPortfolioLevel(record)) {
            //If parent is the lowest level PI, fetch projects and augment with project breakdown
            this.drawChildProjects(parentTreeItem);
        } else {
            this.callParent(arguments);
        }
    },

    computePortfolioItemRisk: function(store) {
        var storiesRemainingByFeatureAndProject = this.storiesRemainingByFeatureAndProject;
        var historicalThroughput = this.config.historicalThroughputByProject;
        store.each(function(portfolioItem) {
            var objectId = portfolioItem.data.ObjectID;
            var startOn = Ext.Date.format(new Date(), "Y-m-d");
            var endBefore = Ext.Date.format(portfolioItem.data.PlannedEndDate, "Y-m-d");

            //If endBefore < startOn, we need Infinity throughput to finish on time, so those
            //features will still display as "at risk" (since we already blew the planned end date)
            var timeline = new Lumenize.Timeline({
                startOn: startOn,
                endBefore: endBefore,
                granularity: Lumenize.Time.DAY
            });
            var workdaysRemaining = timeline.getAll().length;

            portfolioItem.data.Projects = {};

            //Count stories remaining by project id
            _.each(storiesRemainingByFeatureAndProject[objectId], function(count, projectOid) {
                portfolioItem.data.Projects[projectOid] = { StoriesRemaining: count }
            });

            //Normalize story count by workdays remaining
            _.each(portfolioItem.data.Projects, function(project, projectOid) {
                project.DaysToCompletion = project.StoriesRemaining * historicalThroughput[projectOid];
                project.AtRisk = project.DaysToCompletion > workdaysRemaining;
            });

            //Determine if project is at risk (required throughput > historical throughput)
            portfolioItem.data.AtRisk = _.any(portfolioItem.data.Projects, function(project) {
                return project.AtRisk;
            });

            portfolioItem.data.WorkdaysRemaining = workdaysRemaining;
            portfolioItem.data.DaysToCompletion = _.max(portfolioItem.data.Projects, 'DaysToCompletion').DaysToCompletion;
        });
    },

    drawChildProjects: function(parentTreeItem) {
        var filter;
        var record = parentTreeItem.getRecord();
        var ids = _.keys(record.data.Projects);

        _.each(ids, function(id) {
            var filterItem = Ext.create('Rally.data.QueryFilter', 
            {
                property: 'ObjectID',
                operator: '=',
                value: id
            });

            filter = filter ? filter.or(filterItem) : filterItem;
        });

        var childStore = Ext.create('Rally.data.WsapiDataStore', {
            autoLoad: true,
            limit: 'Infinity',
            model: 'Project',
            filters: filter,
            listeners: {
                load: Ext.bind(function(store, records, success) {
                    _.each(records, function(project) {
                        _.each(record.data.Projects, function(projectRisk, projectOid) {
                            if (projectOid == project.data.ObjectID) {
                                _.merge(project.data, projectRisk);
                            }
                        });
                    });
                    this.renderChildRecords(Ext.clone(records), parentTreeItem);
                }, this)
            }
        });

        parentTreeItem.store = childStore;
    },

    loadStoriesRemainingByFeatureAndProject: function(callback) {
        Ext.create('Rally.data.lookback.SnapshotStore', {
            // TODO - account for > 20k results
            autoLoad: true,
            fetch: ['_ProjectHierarchy', '_ItemHierarchy'],
            findConfig: {
                "_TypeHierarchy": "HierarchicalRequirement",
                "__At": "current",
                "ScheduleState": {
                    "$lt": "Accepted"
                },
                "Feature": {//TODO - will this always work?
                    "$exists": true
                }
            },
            listeners: {
                load: Ext.bind(function(store, data, success) {
                    var stories = _.pluck(data, 'raw');

                    //Count stories remaining by project id
                    var storiesRemainingByFeatureAndProject = {};
                    _.each(stories, function(story) {
                        _.each(story._ItemHierarchy, function(objectId) {
                            var projects = storiesRemainingByFeatureAndProject[objectId] = storiesRemainingByFeatureAndProject[objectId] || {};
                            projects[story.Project] = projects[story.Project] || 0;
                            projects[story.Project]++;
                        });
                    });

                    this.storiesRemainingByFeatureAndProject = storiesRemainingByFeatureAndProject;

                    callback();
                }, this)
            }
        });
    },

    treeItemConfigForRecordFn: function(record) {
        return { xtype: 'rallyportfolioforecasttreeitem' }
    }
});

Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',

    launch: function() {
        this.add({
            xtype: 'fieldset',
            title: 'Portfolio items starting and ending between',
            items: [
                {
                    xtype: 'datefield',
                    id: 'portfolioItemsStart',
                    itemId: 'portfolioItemsStart',
                    fieldLabel: 'Start',
                    value: (new Lumenize.Time(NOW)).add(-3, Lumenize.Time.MONTH).getJSDate('UTC'), // 3 months ago
                    listeners: {
                        change: Ext.bind(this.loadPortfolioItems, this)
                    }
                },
                {
                    xtype: 'datefield',
                    id: 'portfolioItemsEnd',
                    itemId: 'portfolioItemsEnd',
                    fieldLabel: 'End',
                    value: (new Lumenize.Time(NOW)).add(3, Lumenize.Time.MONTH).getJSDate('UTC'), // 3 months from now
                    listeners: {
                        change: Ext.bind(this.loadPortfolioItems, this)
                    }
                }
            ]
        });

        this.add({
            xtype: 'fieldset',
            title: 'Sample historical throughput between',
            items: [
                {
                    xtype: 'datefield',
                    id: 'historicalThroughputStart',
                    itemId: 'historicalThroughputStart',
                    fieldLabel: 'Start',
                    maxValue: NOW,
                    value: (new Lumenize.Time(NOW)).add(-3, Lumenize.Time.MONTH).getJSDate('UTC'),
                    listeners: {
                        change: Ext.bind(this.loadThroughputByProjectAndPortfolioItems, this)
                    }
                },
                {
                    xtype: 'datefield',
                    id: 'historicalThroughputEnd',
                    itemId: 'historicalThroughputEnd',
                    fieldLabel: 'End',
                    maxValue: NOW,
                    value: NOW,
                    listeners: {
                        change: Ext.bind(this.loadThroughputByProjectAndPortfolioItems, this)
                    }
                }
            ]
        });

        this.loadThroughputByProjectAndPortfolioItems();
    },
    
    getSnapshots: function(config) {
        var workspaceOid = this.context.getWorkspace().ObjectID;
        var deferred = new Deft.Deferred();
        Ext.create('Rally.data.lookback.SnapshotStore', _.merge({
            // TODO - account for > 20k results
            autoLoad: true,
            context: {
                workspace: '/workspace/' + workspaceOid
            },
            listeners: {
                load: function(store, data, success) {
                    deferred.resolve(_.pluck(data, 'raw'));
                }
            }
        }, config));

        return deferred.getPromise();
    },
    
    throughputByProject: function() {
        var start = Ext.Date.format(Ext.getCmp('historicalThroughputStart').getValue(), "Y-m-d");
        var end = Ext.Date.format(Ext.getCmp('historicalThroughputEnd').getValue(), "Y-m-d");

        var timeline = new Lumenize.Timeline({
            startOn: start,
            endBefore: end,
            granularity: Lumenize.Time.DAY
        });
        var workdays = timeline.getAll().length;

        //Stories transitioned from <Accepted to >=Accepted
        var forwardThroughput = this.getSnapshots({
            fetch: ['_ProjectHierarchy'],
            findConfig: {
                "_TypeHierarchy": "HierarchicalRequirement",
                "_PreviousValues.ScheduleState": {
                    "$exists": true,
                    "$lt": "Accepted"
                },
                "ScheduleState": {
                    "$gte": "Accepted"
                },
                "_ValidFrom": {
                    "$lt": end,
                    "$gte": start
                }
            }
        });

        //Stories transitioned from >=Accepted to <Accepted
        var backwardThroughput = this.getSnapshots({
            fetch: ['_ProjectHierarchy'],
            findConfig: {
                "_TypeHierarchy": "HierarchicalRequirement",
                "_PreviousValues.ScheduleState": {
                    "$exists": true,
                    "$gte": "Accepted"
                },
                "ScheduleState": {
                    "$lt": "Accepted"
                },
                "_ValidFrom": {
                    "$lt": end,
                    "$gte": start
                }
            }
        });

        //Group into lookup table by project oid
        return Deft.Promise.all([ forwardThroughput, backwardThroughput ]).then(function(results) {
            var forward = results[0];
            var backward = results[1];
            var throughput = {};
            
            // Add forward throughput
            _.each(forward, function(snapshot) {
                _.each(snapshot._ProjectHierarchy, function(projectOid) {
                    throughput[projectOid] = throughput[projectOid] || 0;
                    throughput[projectOid]++;
                });
            });

            //Subtract backward throughput
            _.each(backward, function(snapshot) {
                _.each(snapshot._ProjectHierarchy, function(projectOid) {
                    throughput[projectOid] = throughput[projectOid] || 0;
                    throughput[projectOid]--;
                });
            });

            //Normalize the throughput by workday
            return _.transform(throughput, function(result, num, key) {
                result[key] = num/workdays;
            });
        });
    },

    loadThroughputByProjectAndPortfolioItems: function() {
        this.historicalThroughputByProject = this.throughputByProject();
        this.loadPortfolioItems();
    },

    loadPortfolioItems: function() {
        var workspaceOid = this.context.getWorkspace().ObjectID;
        var portfolioItemsStart = Ext.Date.format(Ext.getCmp('portfolioItemsStart').getValue(), "Y-m-d");
        var portfolioItemsEnd = Ext.Date.format(Ext.getCmp('portfolioItemsEnd').getValue(), "Y-m-d");

        this.historicalThroughputByProject.then(Ext.bind(function(historicalThroughputByProject) {
            //TODO - update and refresh existing tree
            this.portfolioTree = this.add({
                xtype: 'portfolioforecasttree',
                id: 'portfoliotree',
                itemId: 'portfoliotree',
                enableDragAndDrop: false,
                historicalThroughputByProject: historicalThroughputByProject,
                //@todo: parameterize PI type
                topLevelModel: workspaceOid == '41529001' ? 'portfolioitem/feature' : 'portfolioitem/epic',
                topLevelStoreConfig: {
                    filters: [{
                        property: 'PlannedStartDate',
                        operator: '>',
                        value: portfolioItemsStart
                    }, {
                        property: 'PlannedEndDate',
                        operator: '<',
                        value: portfolioItemsEnd
                    }, {
                        property: 'DirectChildrenCount', //Only show PIs that have children
                        operator: '>',
                        value: 0
                    }, {
                        property: 'PercentDoneByStoryCount', //Do not show completed PIs
                        operator: '<',
                        value: 1
                    }]
                }
            });
        }, this));
    }
});
