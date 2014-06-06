Ext.define('CustomApp', {
    extend: 'Rally.app.App',
    componentCls: 'app',
    items:{ html:'<a href="https://help.rallydev.com/apps/2.0rc2/doc/">App SDK 2.0rc2 Docs</a>'},
    launch: function() {
        //Last 3 months
        this.throughputByProject('2014-03', '2014-06').then(function(lookup) {
            console.log(lookup);
        });
    },
    
    throughputByProject: function(start, end) {
        var workspaceOid = this.context.getWorkspace().ObjectID;

        //Stories transitioned from <Accepted to >=Accepted
        var forwardThroughput = new Deft.Deferred();
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad: true,
            context: {
                workspace: '/workspace/' + workspaceOid
            },
            listeners: {
                load: function(store, data, success) {
                    forwardThroughput.resolve(_.pluck(data, 'raw'));
                }
            },
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
        var backwardThroughput = new Deft.Deferred();
        Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad: true,
            context: {
                workspace: '/workspace/' + workspaceOid
            },
            listeners: {
                load: function(store, data, success) {
                    backwardThroughput.resolve(_.pluck(data, 'raw'));
                }
            },
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
        return Deft.Promise.all([
            forwardThroughput.getPromise(),
            backwardThroughput.getPromise()
        ]).then(function(results) {
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
            
            return throughput;
        });
    }
});
